require('dotenv').config({ path: '.env.build' });
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const path    = require('path');
const rateLimit = require('express-rate-limit');

const authRoutes         = require('./routes/auth');
const whatsappRoutes     = require('./routes/whatsapp');
const metaRoutes         = require('./routes/meta');
const crmRoutes          = require('./routes/crm');
const waBusinessRoutes   = require('./routes/waBusiness');
const multipedidosRoutes = require('./routes/multipedidos');
const dashboardRoutes    = require('./routes/dashboard');

const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Muitas requisicoes. Tente novamente em breve.' },
});
app.use(limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
});

app.use('/api/whatsapp/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

app.get('/', (req, res) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://unpkg.com https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline'; " +
    "connect-src *; " +
    "img-src 'self' data:; " +
    "font-src 'self' data:;"
  );
  res.sendFile(path.join(__dirname, '..', 'zapcloud.html'));
});

app.get('/privacidade', (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'privacidade.html'));
});

app.get('/termos', (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'termos.html'));
});

app.use('/api/auth',         authLimiter, authRoutes);
app.use('/api/whatsapp',     whatsappRoutes);
app.use('/api/meta',         metaRoutes);
app.use('/api/crm',          crmRoutes);
app.use('/api/wa-business',  waBusinessRoutes);
app.use('/api/multipedidos', multipedidosRoutes);
app.use('/api/dashboard',    dashboardRoutes);

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'ZapCloud API esta funcionando.',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
    version: '1.2.0',
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Rota nao encontrada.' });
});

app.use((err, req, res, next) => {
  console.error('[Error Handler]', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Erro interno do servidor.',
  });
});

app.listen(PORT, async () => {
  console.log('ZapFood API rodando na porta ' + PORT);
  console.log('Ambiente: ' + (process.env.NODE_ENV || 'development'));

  // Fix: criar wabaAccount do Forest Burger se não existir
  try {
    const prisma = require('./utils/prisma');
    const existing = await prisma.wabaAccount.findUnique({ where: { phoneNumberId: '1274171199105136' } });
    if (!existing) {
      await prisma.wabaAccount.create({
        data: {
          userId:        '54db6bb3-1afe-4c62-995a-8f3015d0dbb3',
          wabaId:        '803593902776258',
          phoneNumberId: '1274171199105136',
          phoneNumber:   '+55 47 9161-6193',
          displayName:   'Forest Burger',
          accessToken:   'EAALa3UkeX8IBSIBeUvbcUfgVunqPSaN1UhPPYRC6GvY0WWmdM4uAD8V7FlCG1cOvnMgiMcJLBoxPQqb0nLFz836XBVHHA8RDLEP35j2RYPs06csgfTJ3umaFNTZBWADfDEsoNOE2mXFd5E4KnaSZCafbww0NDQ8TAodsBHT83nShrMH2pSCtSBeUR8Ap5DygZDZD',
          isActive:      true,
        },
      });
      console.log('[Fix] wabaAccount Forest Burger criado com sucesso.');
    } else if (existing.userId !== '54db6bb3-1afe-4c62-995a-8f3015d0dbb3') {
      await prisma.wabaAccount.update({
        where: { phoneNumberId: '1274171199105136' },
        data: { userId: '54db6bb3-1afe-4c62-995a-8f3015d0dbb3' },
      });
      console.log('[Fix] Forest Burger userId corrigido.');
    }
  } catch (e) {
    console.error('[Fix] Erro Forest Burger:', e.message);
  }
});

module.exports = app;
