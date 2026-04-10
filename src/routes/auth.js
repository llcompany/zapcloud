const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const { register, login, refreshToken, me } = require('../controllers/authController');
const { authenticate } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');

// POST /api/auth/register
router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Nome é obrigatório.'),
    body('email').isEmail().withMessage('E-mail inválido.').normalizeEmail(),
    body('password')
      .isLength({ min: 8 })
      .withMessage('A senha deve ter pelo menos 8 caracteres.'),
  ],
  validate,
  register
);

// POST /api/auth/login
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('E-mail inválido.').normalizeEmail(),
    body('password').notEmpty().withMessage('Senha é obrigatória.'),
  ],
  validate,
  login
);

// POST /api/auth/refresh
router.post(
  '/refresh',
  [body('refreshToken').notEmpty().withMessage('Refresh token é obrigatório.')],
  validate,
  refreshToken
);

// GET /api/auth/me
router.get('/me', authenticate, me);

module.exports = router;
