const jwt = require('jsonwebtoken');


const prisma = require('../utils/prisma');

/**
 * Middleware de autenticação JWT.
 * Verifica o token no header Authorization: Bearer <token>
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Token de autenticação não fornecido.',
      });
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expirado. Faça login novamente.',
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Token inválido.',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não encontrado ou inativo.',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('[Auth Middleware] Erro:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro interno na autenticação.',
    });
  }
};

/**
 * Middleware de autorização por papel (role).
 * Uso: authorize('ADMIN')
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Não autenticado.',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Você não tem permissão para acessar este recurso.',
      });
    }

    next();
  };
};

module.exports = { authenticate, authorize };
