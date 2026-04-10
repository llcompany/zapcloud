const waBusiness  = require('../services/waBusiness');

/**
 * POST /api/wa-business/session
 * Inicia uma nova sessão WA Business para o usuário logado.
 */
async function startSession(req, res) {
  try {
    const sessionId = `user_${req.user.id}`;
    const session   = waBusiness.getSession(sessionId);

    // Já conectada?
    if (session && session.status === 'connected') {
      return res.json({
        success: true,
        sessionId,
        status: 'connected',
        phone: session.phone,
        name:  session.name,
      });
    }

    // Inicia (ou reinicia) a sessão — não aguarda conexão completa
    waBusiness.startSession(sessionId).catch(err => {
      console.error('[WA Business] Erro ao iniciar sessão:', err.message);
    });

    return res.json({ success: true, sessionId, status: 'connecting' });
  } catch (err) {
    console.error('[WA Business] startSession error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * GET /api/wa-business/session/:sessionId
 * Retorna o status atual e o QR code (se disponível).
 */
async function getStatus(req, res) {
  try {
    const { sessionId } = req.params;
    const session = waBusiness.getSession(sessionId);

    if (!session) {
      return res.json({ success: true, status: 'not_started' });
    }

    return res.json({
      success:  true,
      status:   session.status,
      qrBase64: session.qrBase64 || null,
      phone:    session.phone    || null,
      name:     session.name     || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * DELETE /api/wa-business/session/:sessionId
 * Desconecta e remove a sessão.
 */
async function deleteSession(req, res) {
  try {
    const { sessionId } = req.params;
    waBusiness.disconnectSession(sessionId);
    res.json({ success: true, message: 'Sessão desconectada.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * POST /api/wa-business/session/:sessionId/send
 * Envia uma mensagem de texto via sessão WA Business.
 * Body: { phone, message }
 */
async function sendMessage(req, res) {
  try {
    const { sessionId }    = req.params;
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ success: false, message: 'phone e message são obrigatórios.' });
    }

    await waBusiness.sendMessage(sessionId, phone, message);
    res.json({ success: true, message: 'Mensagem enviada.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { startSession, getStatus, deleteSession, sendMessage };
