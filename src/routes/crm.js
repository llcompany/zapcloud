const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();
const { listCustomers, upsertCustomer, importCustomers, getMetrics, deleteCustomer, deleteBySource, getCustomerOrders } = require('../controllers/crmController');
const { listCampaigns, createCampaign, previewSegment, executeCampaign, getCampaign, testSend } = require('../controllers/campaignController');
const { authenticate, validateWabaOwnership } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');

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
module.exports = router;
