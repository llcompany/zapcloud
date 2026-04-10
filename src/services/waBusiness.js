/**
 * WhatsApp Business – gerenciador de sessões via Baileys (QR Code)
 * Cada usuário tem uma sessão identificada pelo userId.
 */

const path = require('path');
const fs   = require('fs');

// qrcode e baileys são carregados sob demanda (podem não estar instalados ainda)
function loadQrcode() {
  try { return require('qrcode'); }
  catch { throw new Error('Pacote qrcode não instalado. Execute: npm install @whiskeysockets/baileys qrcode'); }
}

// Map sessionId -> { status, qrBase64, socket, phone, name }
const sessions = new Map();

// ── Pasta para guardar credenciais (persiste entre reinícios) ──
function authFolder(sessionId) {
  const dir = path.join(__dirname, '../../wa-sessions', sessionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Iniciar / reconectar sessão ────────────────────────────────
async function startSession(sessionId) {
  // Se já existe e está conectada, não recria
  const existing = sessions.get(sessionId);
  if (existing && existing.status === 'connected') return existing;

  // Lazy-load Baileys (evita erro se não instalado ainda)
  let makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion;
  try {
    const baileys = require('@whiskeysockets/baileys');
    makeWASocket             = baileys.default || baileys.makeWASocket;
    DisconnectReason         = baileys.DisconnectReason;
    useMultiFileAuthState    = baileys.useMultiFileAuthState;
    fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
  } catch {
    throw new Error('Pacote @whiskeysockets/baileys não instalado. Execute: npm install @whiskeysockets/baileys qrcode');
  }

  const folder = authFolder(sessionId);
  const { state, saveCreds } = await useMultiFileAuthState(folder);

  let version = [2, 3000, 1015901307];
  try {
    const v = await fetchLatestBaileysVersion();
    version = v.version;
  } catch { /* usa versão padrão */ }

  const sessionData = {
    status: 'connecting',
    qrBase64: null,
    socket: null,
    phone: null,
    name: null,
  };
  sessions.set(sessionId, sessionData);

  const pino = (() => {
    try { return require('pino')({ level: 'silent' }); }
    catch { return { child: () => ({ level: 'silent', info(){}, warn(){}, error(){}, debug(){} }) }; }
  })();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino.child ? pino.child({}) : pino,
    browser: ['ZapCloud', 'Chrome', '1.0.0'],
  });

  sessionData.socket = sock;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const qrcode = loadQrcode();
        sessionData.qrBase64 = await qrcode.toDataURL(qr);
        sessionData.status   = 'qr_ready';
      } catch { sessionData.status = 'qr_ready'; }
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      if (loggedOut) {
        sessionData.status = 'disconnected';
        sessions.delete(sessionId);
        // Limpa credenciais salvas
        try { fs.rmSync(folder, { recursive: true, force: true }); } catch {}
      } else {
        sessionData.status = 'reconnecting';
        setTimeout(() => startSession(sessionId), 3000);
      }
    }

    if (connection === 'open') {
      sessionData.status  = 'connected';
      sessionData.qrBase64 = null;
      // Pega info do número conectado
      try {
        const me = sock.user;
        sessionData.phone = me?.id?.split(':')[0] || me?.id;
        sessionData.name  = me?.name || me?.verifiedName;
      } catch {}
    }
  });

  sock.ev.on('creds.update', saveCreds);

  return sessionData;
}

function getSession(sessionId) {
  return sessions.get(sessionId);
}

async function sendMessage(sessionId, phone, message) {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'connected') {
    throw new Error('Sessão WhatsApp Business não conectada');
  }
  // Formata número: remove não-dígitos, adiciona @s.whatsapp.net
  const number = phone.replace(/\D/g, '');
  const jid    = number.includes('@') ? number : `${number}@s.whatsapp.net`;
  await session.socket.sendMessage(jid, { text: message });
}

function disconnectSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session && session.socket) {
    try { session.socket.end(undefined); } catch {}
  }
  sessions.delete(sessionId);
}

function listSessions() {
  const result = [];
  sessions.forEach((data, id) => {
    result.push({ sessionId: id, status: data.status, phone: data.phone, name: data.name });
  });
  return result;
}

module.exports = { startSession, getSession, sendMessage, disconnectSession, listSessions };
