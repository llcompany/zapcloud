const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/multipedidosController');

// Webhook público — Multipedidos chama esta URL a cada novo pedido
// Suporta URL genérica e URL por conta (multi-tenant)
router.post('/webhook', ctrl.receiveOrder);
router.post('/webhook/:wabaAccountId', ctrl.receiveOrder);

// Rota para checar status da integração (autenticada)
const { authenticate, authorize } = require('../middlewares/auth');
router.get('/status', authenticate, ctrl.getStatus);

// Backfill: recalcular tags e daysSinceOrder de todos os clientes
router.post('/backfill-tags', authenticate, ctrl.backfillTags);

// Backfill: recalcular topItem e preferredDayOfWeek de todos os clientes
router.get('/backfill-preferred', authenticate, authorize('ADMIN'), ctrl.backfillPreferred);

module.exports = router;
