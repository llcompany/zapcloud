const express = require('express');
const { param } = require('express-validator');
const router = express.Router();

const { trackClick, getSegmentOptions } = require('../controllers/campaignController');
const { authenticate, validateWabaOwnership } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');

// GET /api/campaigns/r/:executionId — rastreia o clique e redireciona.
// Rota PÚBLICA de propósito: quem abre é o cliente final pelo WhatsApp, sem sessão.
// O executionId é um UUID, então não é enumerável.
router.get('/r/:executionId', [param('executionId').isUUID()], validate, trackClick);

// GET /api/campaigns/:wabaAccountId/segment-options — origens e tags da base do
// tenant para o formulário de campanha. validateWabaOwnership impede que um
// usuário autenticado consulte segmentos de conta que não é dele.
router.get('/:wabaAccountId/segment-options', authenticate, validateWabaOwnership, getSegmentOptions);

module.exports = router;
