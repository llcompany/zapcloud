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

const UUID_RULE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Middleware de autorização multi-tenant.
 * Garante que o :wabaAccountId da rota pertence ao usuário autenticado.
 * Deve vir sempre DEPOIS de `authenticate` (depende de req.user).
 *
 * ADMIN passa direto, para suporte conseguir inspecionar qualquer conta.
 */
const validateWabaOwnership = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Não autenticado.' });
    }

    if (req.user.role === 'ADMIN') return next();

    const { wabaAccountId } = req.params;

    // Sem o id não há o que validar — melhor barrar do que deixar passar
    if (!wabaAccountId) {
      return res.status(400).json({ success: false, message: 'ID da conta não informado.' });
    }

    // Evita mandar string malformada para uma coluna uuid do Postgres
    if (!UUID_RULE.test(wabaAccountId)) {
      return res.status(400).json({ success: false, message: 'ID de conta inválido.' });
    }

    const account = await prisma.wabaAccount.findFirst({
      where: { id: wabaAccountId, userId: req.user.id },
      select: { id: true, phoneNumberId: true, isActive: true },
    });

    if (!account) {
      // Mesma resposta para "não existe" e "é de outro dono", para não vazar
      // quais contas existem na plataforma
      console.warn(`[Auth] Acesso negado: user ${req.user.id} tentou acessar waba ${wabaAccountId}`);
      return res.status(403).json({ success: false, message: 'Acesso negado' });
    }

    req.wabaAccount = account;
    next();
  } catch (error) {
    console.error('[Auth] validateWabaOwnership:', error);
    return res.status(500).json({ success: false, message: 'Erro ao validar acesso à conta.' });
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

module.exports = { authenticate, authorize, validateWabaOwnership };
