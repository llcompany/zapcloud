const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middlewares/auth');
const { getMetrics }   = require('../controllers/dashboardController');

router.use(authenticate);
router.get('/metrics', getMetrics);

module.exports = router;
