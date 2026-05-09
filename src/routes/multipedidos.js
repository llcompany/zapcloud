const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/multipedidosController');

// Webhook público — Multipedidos chama esta URL a cada novo pedido
router.post('/webhook', ctrl.receiveOrder);

// Rota para checar status da integração (autenticada)
const { authenticate } = require('../middlewares/auth');
router.get('/status', authenticate, ctrl.getStatus);

// Backfill: recalcular tags e daysSinceOrder de todos os clientes
router.post('/backfill-tags', authenticate, ctrl.backfillTags);

module.exports = router;
