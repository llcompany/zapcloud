const express = require('express');
const router = express.Router();

const {
  getAuthUrl,
  handleCallback,
  listWabaAccounts,
  disconnectWabaAccount,
} = require('../controllers/metaController');
const { authenticate } = require('../middlewares/auth');

// Todas as rotas de integração Meta requerem autenticação
router.use(authenticate);

// GET /api/meta/auth-url — gera a URL do popup de Embedded Signup
router.get('/auth-url', getAuthUrl);

// GET /api/meta/callback — callback OAuth após o usuário autorizar
// (o state carrega o userId; o middleware authenticate também valida)
router.get('/callback', handleCallback);

// GET /api/meta/accounts — lista contas WABA do usuário
router.get('/accounts', listWabaAccounts);

// DELETE /api/meta/accounts/:wabaAccountId — desconectar conta
router.delete('/accounts/:wabaAccountId', disconnectWabaAccount);

module.exports = router;
