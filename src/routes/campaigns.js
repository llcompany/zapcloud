const express = require('express');
const { param } = require('express-validator');
const router = express.Router();

const { trackClick } = require('../controllers/campaignController');
const { validate } = require('../middlewares/validate');

// GET /api/campaigns/r/:executionId — rastreia o clique e redireciona.
// Rota PÚBLICA de propósito: quem abre é o cliente final pelo WhatsApp, sem sessão.
// O executionId é um UUID, então não é enumerável.
router.get('/r/:executionId', [param('executionId').isUUID()], validate, trackClick);

module.exports = router;
