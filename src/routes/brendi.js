const express = require('express');
const router = express.Router();
const { receiveOrder, getStatus } = require('../controllers/brendiController');
const auth = require('../middleware/auth');

// Webhook recebido da Brendi (sem auth — chamado pela Brendi)
// OBRIGATÓRIO informar o wabaAccountId na URL para evitar mistura entre empresas
router.post('/:wabaAccountId', receiveOrder);

// Status para o painel interno
router.get('/status', auth, getStatus);

module.exports = router;
