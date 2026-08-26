const express = require('express');
const multer = require('multer');
const { body, param } = require('express-validator');
const router = express.Router();
const { listCustomers, upsertCustomer, importCustomers, getMetrics, deleteCustomer, deleteBySource, getCustomerOrders } = require('../controllers/crmController');
const { importContacts } = require('../controllers/contactController');
const { listCampaigns, createCampaign, previewSegment, executeCampaign, getCampaign, testSend, getCampaignConversions, getCampaignReport, forceCompleteCampaign, getCampaignConverters } = require('../controllers/campaignController');
const { authenticate, validateWabaOwnership } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');

// Upload em memória para importação de contatos (.csv/.xlsx, máx. 5MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(csv|xlsx)$/i.test(file.originalname || '');
    cb(ok ? null : new Error('Formato inválido. Envie um arquivo .csv ou .xlsx.'), ok);
  },
});

router.use(authenticate);

// Toda rota deste router é escopada por :wabaAccountId. Aplicar o dono aqui,
// em vez de rota a rota, garante que qualquer rota nova nasça protegida.
router.use('/:wabaAccountId', validateWabaOwnership);

// ─── Clientes ─────────────────────────────────────────────────────────────────
router.get('/:wabaAccountId/customers', listCustomers);
router.get('/:wabaAccountId/metrics', getMetrics);
router.put('/:wabaAccountId/customers', [
  param('wabaAccountId').isUUID(),
  body('phone').notEmpty().withMessage('Telefone obrigatório.'),
], validate, upsertCustomer);
router.delete('/:wabaAccountId/customers/bulk', deleteBySource);
router.delete('/:wabaAccountId/customers/:customerId', deleteCustomer);
router.get('/:wabaAccountId/customers/:customerId/orders', getCustomerOrders);
router.post('/:wabaAccountId/contacts/import', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo muito grande (máx. 5MB).' : err.message;
      return res.status(400).json({ success: false, message: msg });
    }
    next();
  });
}, importContacts);
router.post('/:wabaAccountId/customers/import', [
  param('wabaAccountId').isUUID(),
  body('customers').isArray().withMessage('Lista de clientes obrigatória.'),
], validate, importCustomers);

// ─── Campanhas ────────────────────────────────────────────────────────────────
router.get('/:wabaAccountId/campaigns', listCampaigns);
router.post('/:wabaAccountId/campaigns', [
  param('wabaAccountId').isUUID(),
  body('name').notEmpty().withMessage('Nome da campanha obrigatório.'),
  // Aceita template (fluxo novo) ou mensagem livre (legado) — validação fina no controller
  body().custom((b) => !!(b.templateId || b.message)).withMessage('Selecione um template ou informe a mensagem.'),
], validate, createCampaign);
router.post('/:wabaAccountId/campaigns/preview', previewSegment);
router.get('/:wabaAccountId/campaigns/:campaignId', getCampaign);
router.post('/:wabaAccountId/campaigns/test-send', testSend);
router.post('/:wabaAccountId/campaigns/:campaignId/execute', executeCampaign);
router.get('/:wabaAccountId/campaigns/:campaignId/conversions', getCampaignConversions);
router.get('/:wabaAccountId/campaigns/:campaignId/converters', getCampaignConverters);
router.get('/:wabaAccountId/campaigns-report', getCampaignReport);
router.post('/:wabaAccountId/campaigns/:campaignId/force-complete', forceCompleteCampaign);
module.exports = router;
