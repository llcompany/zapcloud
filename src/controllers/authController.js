const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ─── Utilitários ────────────────────────────────────────────────────────────

const generateAccessToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

const generateRefreshToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });

// ─── Registro ────────────────────────────────────────────────────────────────

const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'E-mail já cadastrado.',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    return res.status(201).json({
      success: true,
      message: 'Usuário criado com sucesso.',
      data: { user, accessToken, refreshToken },
    });
  } catch (error) {
    console.error('[Auth] register:', error);
    return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
  }
};

// ─── Login ───────────────────────────────────────────────────────────────────

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas.',
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas.',
      });
    }

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    return res.json({
      success: true,
      message: 'Login realizado com sucesso.',
      data: {
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    console.error('[Auth] login:', error);
    return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
  }
};

// ─── Refresh Token ───────────────────────────────────────────────────────────

const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: 'Refresh token não fornecido.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: 'Refresh token inválido ou expirado.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Usuário não encontrado.' });
    }

    const newAccessToken = generateAccessToken(user.id);
    const newRefreshToken = generateRefreshToken(user.id);

    return res.json({
      success: true,
      data: { accessToken: newAccessToken, refreshToken: newRefreshToken },
    });
  } catch (error) {
    console.error('[Auth] refreshToken:', error);
    return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
  }
};

// ─── Perfil do usuário autenticado ───────────────────────────────────────────

const me = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        wabaAccounts: {
          select: { id: true, wabaId: true, phoneNumberId: true, displayName: true, isActive: true },
        },
      },
    });

    return res.json({ success: true, data: user });
  } catch (error) {
    console.error('[Auth] me:', error);
    return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
  }
};

module.exports = { register, login, refreshToken, me };
