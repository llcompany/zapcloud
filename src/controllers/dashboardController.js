
const prisma = require('../utils/prisma');

/**
 * GET /api/dashboard/metrics
 * Retorna métricas reais para o Dashboard.
 */
async function getMetrics(req, res) {
  try {
    // Pega a WabaAccount do usuário logado
    const wabaAccount = await prisma.wabaAccount.findFirst({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'asc' },
    });

    if (!wabaAccount) {
      return res.json({
        success: true,
        data: emptyMetrics(),
      });
    }

    const wabaId = wabaAccount.id;
    const now    = new Date();
    const d7     = new Date(now - 7  * 24 * 60 * 60 * 1000);
    const d30    = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const hoje   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // Ontem às 00:00 — ignora dados históricos importados
    const ontem  = new Date(hoje - 1 * 24 * 60 * 60 * 1000);

    // Apenas clientes que vieram pelo Multipedidos (não importados)
    const baseWhere = { wabaAccountId: wabaId, source: 'multipedidos' };

    // ── Totais gerais (somente pedidos reais via Multipedidos) ───
    const [total, ativos7, ativos30, pedidos48h] = await Promise.all([
      prisma.crmCustomer.count({ where: baseWhere }),
      prisma.crmCustomer.count({ where: { ...baseWhere, lastOrderAt: { gte: d7  } } }),
      prisma.crmCustomer.count({ where: { ...baseWhere, lastOrderAt: { gte: d30 } } }),
      // Pedidos nas últimas 48h (ontem + hoje)
      prisma.crmCustomer.count({ where: { ...baseWhere, lastOrderAt: { gte: ontem } } }),
    ]);

    // ── Ticket médio (somente Multipedidos) ─────────────────────
    const ticketAgg = await prisma.crmCustomer.aggregate({
      where: baseWhere,
      _avg:  { averageTicket: true },
      _sum:  { totalSpent: true, totalOrders: true },
    });

    const ticketMedio  = ticketAgg._avg.averageTicket || 0;
    const totalGasto   = ticketAgg._sum.totalSpent    || 0;
    const totalPedidos = ticketAgg._sum.totalOrders   || 0;

    // ── Campanhas ────────────────────────────────────────────────
    const [campanhasTotal, campanhasAtivas] = await Promise.all([
      prisma.campaign.count({ where: { wabaAccountId: wabaId } }),
      prisma.campaign.count({ where: { wabaAccountId: wabaId, status: 'RUNNING' } }),
    ]);

    // ── Pedidos por dia — últimos 7 dias, somente Multipedidos ──
    const clientesPorDia = await prisma.$queryRaw`
      SELECT
        DATE(last_order_at) as dia,
        COUNT(*) as total
      FROM crm_customers
      WHERE waba_account_id = ${wabaId}
        AND source = 'multipedidos'
        AND last_order_at >= ${d7}
      GROUP BY DATE(last_order_at)
      ORDER BY dia ASC
    `.catch(() => []);

    // Monta array dos últimos 7 dias (preenche vazios com 0)
    const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const chartData = [];
    for (let i = 6; i >= 0; i--) {
      const d   = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split('T')[0];
      const found = clientesPorDia.find(r => {
        const rKey = r.dia instanceof Date
          ? r.dia.toISOString().split('T')[0]
          : String(r.dia).split('T')[0];
        return rKey === key;
      });
      chartData.push({
        d: dias[d.getDay()],
        e: Number(found?.total || 0),   // pedidos/clientes ativos
        r: Math.round(Number(found?.total || 0) * 0.6), // estimativa engajamento
      });
    }

    res.json({
      success: true,
      data: {
        totalClientes:   total,
        ativos7dias:     ativos7,
        ativos30dias:    ativos30,
        pedidosHoje: pedidos48h,
        ticketMedio:     parseFloat(ticketMedio.toFixed(2)),
        totalGasto:      parseFloat(totalGasto.toFixed(2)),
        totalPedidos,
        campanhasTotal,
        campanhasAtivas,
        chartData,
      },
    });
  } catch (err) {
    console.error('[Dashboard] Erro:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

function emptyMetrics() {
  const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const now  = new Date();
  return {
    totalClientes:  0, ativos7dias:   0, ativos30dias:  0,
    pedidosHoje:    0, ticketMedio:   0, totalGasto:    0,
    totalPedidos:   0, campanhasTotal:0, campanhasAtivas:0,
    chartData: Array.from({length:7},(_,i)=>{
      const d=new Date(now-(6-i)*86400000);
      return {d:dias[d.getDay()],e:0,r:0};
    }),
  };
}

module.exports = { getMetrics };
