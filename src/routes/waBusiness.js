const express    = require('express');
const { authenticate } = require('../middlewares/auth');
const ctrl = require('../controllers/waBusinessController');

const router = express.Router();

// Todas as rotas exigem autenticação
router.use(authenticate);

router.post('/session',                         ctrl.startSession);
router.get('/session/:sessionId',               ctrl.getStatus);
router.delete('/session/:sessionId',            ctrl.deleteSession);
router.post('/session/:sessionId/send',         ctrl.sendMessage);

module.exports = router;
