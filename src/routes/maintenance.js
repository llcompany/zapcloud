const express = require('express');
const router = express.Router();
const { recalcDaysSinceOrder } = require('../controllers/maintenanceController');

router.post('/recalc-days', recalcDaysSinceOrder);

module.exports = router;
