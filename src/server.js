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
const campaignRoutes     = require('./routes/campaigns');
const waBusinessRoutes   = require('./routes/waBusiness');
const multipedidosRoutes = require('./routes/multipedidos');
const dashboardRoutes    = require('./routes/dashboard');
const maintenanceRoutes  = require('./routes/maintenance');

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

app.use(express.static(path.join(__dirname, '..', 'public')));

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
app.use('/api/campaigns',    campaignRoutes);
app.use('/api/wa-business',  waBusinessRoutes);
app.use('/api/multipedidos', multipedidosRoutes);
app.use('/api/dashboard',    dashboardRoutes);
app.use('/internal',         maintenanceRoutes);

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

  // Fix: criar/atualizar wabaAccount do Forest Burger
  const FOREST_TOKEN = 'EAALa3UkeX8IBSMQqpllFJgsUtZCigth70SeZBCRKxZBjSGGrlT7FB8ZCZAz38QQuC959AkTUT178utJFZAZAepR0h1jXtnA48CzxKcA9Bsp4ZCkcRIqj1FMdIMMyJdRnaoeoIEMqIwRTbXfiuSITg4OlkqBWg6qdSIRLUFygpRWBKdgSNYwXy4Usqk3ZAJgZALKfeDRQZDZD';
  const prisma = require('./utils/prisma');
  try {
    const existing = await prisma.wabaAccount.findUnique({ where: { phoneNumberId: '1274171199105136' } });
    if (!existing) {
      await prisma.wabaAccount.create({
        data: {
          userId:        '54db6bb3-1afe-4c62-995a-8f3015d0dbb3',
          wabaId:        '803593902776258',
          phoneNumberId: '1274171199105136',
          phoneNumber:   '+55 47 9161-6193',
          displayName:   'Forest Burger',
          accessToken:   FOREST_TOKEN,
          isActive:      true,
        },
      });
      console.log('[Fix] wabaAccount Forest Burger criado com sucesso.');
    } else {
      // Atualizar userId e token sempre que necessário
      const updates = {};
      if (existing.userId !== '54db6bb3-1afe-4c62-995a-8f3015d0dbb3') updates.userId = '54db6bb3-1afe-4c62-995a-8f3015d0dbb3';
      if (existing.accessToken !== FOREST_TOKEN) updates.accessToken = FOREST_TOKEN;
      if (Object.keys(updates).length > 0) {
        await prisma.wabaAccount.update({ where: { phoneNumberId: '1274171199105136' }, data: updates });
        console.log('[Fix] Forest Burger atualizado:', Object.keys(updates).join(', '));
      }
    }
  } catch (e) {
    console.error('[Fix] Erro Forest Burger:', e.message);
  }

  // Subscrever WABA Forest Burger ao webhook do app
  try {
    const axios = require('axios');
    const fb = await prisma.wabaAccount.findUnique({ where: { phoneNumberId: '1274171199105136' } });
    if (fb && fb.accessToken) {
      const BUSINESS_ID = '191098610746680';
      // Busca WABAs do negócio para obter o wabaId real
      const wabaRes = await axios.get(
        `https://graph.facebook.com/v20.0/${BUSINESS_ID}/owned_whatsapp_business_accounts`,
        { params: { access_token: fb.accessToken }, timeout: 10000 }
      );
      const wabas = wabaRes.data.data;
      console.log('[Fix] WABAs encontradas:', JSON.stringify(wabas?.map(w => ({ id: w.id, name: w.name }))));
      if (wabas && wabas.length > 0) {
        const realWabaId = wabas[0].id;
        // Inscrever o app para receber eventos deste WABA
        const subRes = await axios.post(
          `https://graph.facebook.com/v20.0/${realWabaId}/subscribed_apps`,
          null,
          { params: { access_token: fb.accessToken }, timeout: 10000 }
        );
        console.log('[Fix] Webhook subscribed_apps:', JSON.stringify(subRes.data));
        // Atualizar wabaId correto no banco
        if (fb.wabaId !== realWabaId) {
          await prisma.wabaAccount.update({
            where: { phoneNumberId: '1274171199105136' },
            data: { wabaId: realWabaId },
          });
          console.log('[Fix] wabaId real atualizado:', realWabaId);
        }
      }
    }
  } catch (e) {
    console.error('[Fix] Erro ao subscrever webhook Forest Burger:', e.response?.data || e.message);
  }
});

module.exports = app;
