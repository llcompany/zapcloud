const express = require('express');
const router = express.Router();
const { deleteReportSnapshot } = require('../controllers/campaignController');
const { authenticate, authorize } = require('../middlewares/auth');

router.use(authenticate);

// Apaga o snapshot de um mês fechado; a próxima consulta recalcula e congela de novo.
// Só ADMIN: usado após importação retroativa de pedidos.
router.delete('/snapshot/:wabaAccountId/:year/:month', authorize('ADMIN'), deleteReportSnapshot);

module.exports = router;
