const prisma = require('../utils/prisma');

// Recalcula daysSinceOrder de toda a base — chamado pelo cron diário.
// Protegido por CRON_SECRET: se a env não estiver definida, a rota fica fechada
// (sem o guard, secret ausente + header ausente seriam undefined === undefined e passariam).
async function recalcDaysSinceOrder(req, res) {
  const secret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  try {
    await prisma.$queryRawUnsafe(`
      UPDATE zapcloud.crm_customers
      SET "daysSinceOrder" = CASE
        WHEN "lastOrderAt" IS NULL THEN 0
        ELSE EXTRACT(DAY FROM (NOW() - "lastOrderAt"))::int
      END
    `);
    console.log('[cron] daysSinceOrder recalculado');
    return res.json({ success: true });
  } catch (err) {
    console.error('[cron] erro:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { recalcDaysSinceOrder };
