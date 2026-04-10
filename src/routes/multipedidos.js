const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/multipedidosController');

// Webhook público — Multipedidos chama esta URL a cada novo pedido
router.post('/webhook', ctrl.receiveOrder);

// Rota para checar status da integração (autenticada)
const { authenticate } = require('../middlewares/auth');
router.get('/status', authenticate, ctrl.getStatus);

module.exports = router;
