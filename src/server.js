// Carrega variáveis capturadas durante o build do Railway (Runtime V2)
require('dotenv').config({ path: '.env.build' });
// Fallback para .env local em desenvolvimento
require('dotenv').config();

// ─── DIAGNÓSTICO DE STARTUP ────────────────────────────────────────────────────
console.log('\n========== STARTUP DIAGNOSTICS ==========');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('DATABASE_URL defined:', !!process.env.DATABASE_URL);
console.log('DATABASE_URL length:', (process.env.DATABASE_URL || '').length);
const allKeys = Object.keys(process.env).sort();
console.log('TOTAL ENV VARS:', allKeys.length);
console.log('ALL KEYS:', allKeys.join(' | '));
console.log('==========================================\n');
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const whatsappRoutes = require('./routes/whatsapp');
const metaRoutes = require('./routes/meta');
const crmRoutes        = require('./routes/crm');
const waBusinessRoutes    = require('./routes/waBusiness');
const multipedidosRoutes  = require('./routes/multipedidos');
const dashboardRoutes     = require('./routes/dashboard');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Segurança ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting global
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Muitas requisições. Tente novamente em breve.' },
});
app.use(limiter);

// Rate limiting mais rigoroso para rotas de auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
});

// ─── Body parsing ─────────────────────────────────────────────────────────────
// Webhook da Meta precisa do raw body para validação de assinatura (se aplicável)
app.use('/api/whatsapp/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Logs ─────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ─── Rotas ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/wa-business', waBusinessRoutes);
app.use('/api/multipedidos', multipedidosRoutes);
app.use('/api/dashboard',   dashboardRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'ZapCloud API está funcionando.',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Rota não encontrada.' });
});

// ─── Error handler global ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error Handler]', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Erro interno do servidor.',
  });
});

// ─── Iniciar servidor ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 ZapCloud API rodando na porta ${PORT}`);
  console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Health:   http://localhost:${PORT}/health\n`);
});

module.exports = app;
