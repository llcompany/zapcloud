const express = require('express');
const { body, param } = require('express-validator');
const multer = require('multer');
const router = express.Router();

// Upload em memória: o buffer vai direto para a Resumable Upload API da Meta.
// A Meta só aceita JPEG/PNG como header de imagem (limite oficial: 5MB).
const headerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Formato inválido. A Meta aceita apenas JPEG ou PNG no header.'));
  },
});

// Converte erros do multer (tipo/tamanho) em resposta JSON padrão da API
const headerUploadMiddleware = (req, res, next) => {
  headerUpload.single('file')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'A imagem deve ter no máximo 5MB.' : err.message;
      return res.status(400).json({ success: false, message });
    }
    next();
  });
};

const {
  getAuthUrl,
  handleCallback,
  listWabaAccounts,
  disconnectWabaAccount,
  updateWabaToken,
  embeddedSignup,
} = require('../controllers/metaController');
const {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  uploadTemplateHeader,
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

// POST /api/meta/embedded-signup — troca o code do FB.login() por token e salva a conta
router.post('/embedded-signup', embeddedSignup);

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

// POST /api/meta/:wabaAccountId/templates/header-upload — sobe a imagem do header
// para a Meta (gera o handle usado na criação) e devolve também a URL pública
router.post(
  '/:wabaAccountId/templates/header-upload',
  [param('wabaAccountId').isUUID()],
  validate,
  headerUploadMiddleware,
  uploadTemplateHeader
);

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
