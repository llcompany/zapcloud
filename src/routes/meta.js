const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();

const {
  getAuthUrl,
  handleCallback,
  listWabaAccounts,
  disconnectWabaAccount,
  updateWabaToken,
} = require('../controllers/metaController');
const {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} = require('../controllers/templateController');
const { authenticate } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');

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

// PATCH /api/meta/accounts/:wabaAccountId/token — atualizar access token
router.patch('/accounts/:wabaAccountId/token', updateWabaToken);

// ─── Templates de mensagem ───────────────────────────────────────────────────
// Declaradas depois das rotas estáticas (/auth-url, /callback, /accounts) para
// que o parâmetro :wabaAccountId não as capture.

// GET /api/meta/:wabaAccountId/templates — lista do banco + sincroniza status na Meta
router.get('/:wabaAccountId/templates', [param('wabaAccountId').isUUID()], validate, listTemplates);

// POST /api/meta/:wabaAccountId/templates — cria na Meta e salva no banco
router.post(
  '/:wabaAccountId/templates',
  [
    param('wabaAccountId').isUUID(),
    body('name').trim().notEmpty().withMessage('Nome do template obrigatório.'),
    body('bodyText').trim().notEmpty().withMessage('Corpo da mensagem obrigatório.'),
  ],
  validate,
  createTemplate
);

// PATCH /api/meta/:wabaAccountId/templates/:id — atualiza custo e link (só no banco)
router.patch(
  '/:wabaAccountId/templates/:id',
  [param('wabaAccountId').isUUID(), param('id').isUUID()],
  validate,
  updateTemplate
);

// DELETE /api/meta/:wabaAccountId/templates/:id — remove na Meta e no banco
router.delete(
  '/:wabaAccountId/templates/:id',
  [param('wabaAccountId').isUUID(), param('id').isUUID()],
  validate,
  deleteTemplate
);

module.exports = router;
