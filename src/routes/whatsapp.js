const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();

const {
  sendTextMessage,
  sendTemplate,
  webhookVerify,
  webhookReceive,
  getMessages,
} = require('../controllers/whatsappController');
const { listContacts, upsertContact, getContact } = require('../controllers/contactController');
const { authenticate } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');

// ─── Webhook (sem autenticação JWT - validado pelo META_VERIFY_TOKEN) ─────────
router.get('/webhook', webhookVerify);
router.post('/webhook', webhookReceive);

// ─── Rotas autenticadas ───────────────────────────────────────────────────────
router.use(authenticate);

// Enviar mensagem de texto
// POST /api/whatsapp/:wabaAccountId/messages/text
router.post(
  '/:wabaAccountId/messages/text',
  [
    param('wabaAccountId').isUUID().withMessage('ID inválido.'),
    body('to').notEmpty().withMessage('Destinatário é obrigatório.'),
    body('message').notEmpty().withMessage('Mensagem é obrigatória.'),
  ],
  validate,
  sendTextMessage
);

// Enviar template
// POST /api/whatsapp/:wabaAccountId/messages/template
router.post(
  '/:wabaAccountId/messages/template',
  [
    param('wabaAccountId').isUUID().withMessage('ID inválido.'),
    body('to').notEmpty().withMessage('Destinatário é obrigatório.'),
    body('templateName').notEmpty().withMessage('Nome do template é obrigatório.'),
  ],
  validate,
  sendTemplate
);

// Buscar mensagens de um contato
// GET /api/whatsapp/:wabaAccountId/contacts/:contactId/messages
router.get('/:wabaAccountId/contacts/:contactId/messages', getMessages);

// Listar contatos
// GET /api/whatsapp/:wabaAccountId/contacts
router.get('/:wabaAccountId/contacts', listContacts);

// Criar/atualizar contato
// PUT /api/whatsapp/:wabaAccountId/contacts
router.put(
  '/:wabaAccountId/contacts',
  [
    param('wabaAccountId').isUUID().withMessage('ID inválido.'),
    body('phone').notEmpty().withMessage('Telefone é obrigatório.'),
  ],
  validate,
  upsertContact
);

// Buscar contato por ID
// GET /api/whatsapp/:wabaAccountId/contacts/:contactId
router.get('/:wabaAccountId/contacts/:contactId', getContact);

module.exports = router;
