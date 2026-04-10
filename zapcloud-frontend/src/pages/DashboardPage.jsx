import { useState, useEffect } from 'react'
import { MessageSquare, Users, CheckCheck, BarChart2, TrendingUp, TrendingDown, Plus, RefreshCw } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { metaAPI } from '../services/api'

const CHART_DATA = [
  { dia: 'Seg', enviadas: 420, recebidas: 180 },
  { dia: 'Ter', enviadas: 680, recebidas: 290 },
  { dia: 'Qua', enviadas: 520, recebidas: 210 },
  { dia: 'Qui', enviadas: 890, recebidas: 340 },
  { dia: 'Sex', enviadas: 1200, recebidas: 480 },
  { dia: 'Sáb', enviadas: 760, recebidas: 310 },
  { dia: 'Dom', enviadas: 430, recebidas: 190 },
]

const RECENT = [
  { name: 'João Silva',     msg: 'Preciso de ajuda com meu pedido', time: '14:32', unread: 2 },
  { name: 'Maria Santos',   msg: 'Obrigada pelo atendimento! 😊',   time: '13:15', unread: 0 },
  { name: 'Carlos Mendes',  msg: 'Quando chega meu produto?',       time: '11:48', unread: 5 },
  { name: 'Ana Oliveira',   msg: 'Perfeito, muito obrigada!',       time: 'Ontem', unread: 0 },
  { name: 'Pedro Costa',    msg: 'Ok, aguardo o retorno',           time: 'Ontem', unread: 0 },
]

function Avatar({ name, size = 40 }) {
  const colors = ['#25D366','#128C7E','#075E54','#34B7F1','#ECB22E','#E01E5A']
  const bg = colors[name.charCodeAt(0) % colors.length]
  return (
    <div className="rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: bg, fontSize: size * 0.38 }}>
      {name.split(' ').map(n => n[0]).slice(0, 2).join('')}
    </div>
  )
}

export default function DashboardPage() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    metaAPI.listAccounts()
      .then(r => setAccounts(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const metrics = [
    { label: 'Mensagens enviadas', value: '12.847', trend: +18, icon: MessageSquare, color: '#25D366' },
    { label: 'Contatos ativos',    value: '3.291',  trend: +7,  icon: Users,         color: '#128C7E' },
    { label: 'Taxa de entrega',    value: '98.3%',  trend: +2,  icon: CheckCheck,    color: '#075E54' },
    { label: 'Taxa de leitura',    value: '74.1%',  trend: -3,  icon: BarChart2,     color: '#34B7F1' },
  ]

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#111B21]">Dashboard</h1>
          <p className="text-sm text-[#667781]">Visão geral da última semana</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#25D366] hover:bg-[#128C7E] transition-colors">
          <Plus size={16} /> Nova mensagem
        </button>
      </div>

      {/* Alerta sem conta */}
      {!loading && accounts.length === 0 && (
        <div className="flex items-center gap-3 px-5 py-4 rounded-2xl bg-amber-50 border border-amber-200">
          <span className="text-2xl">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">Nenhuma conta WhatsApp conectada</p>
            <p className="text-xs text-amber-700">
              <a href="/connect" className="underline">Clique aqui</a> para vincular sua conta WABA e começar a enviar mensagens.
            </p>
          </div>
        </div>
      )}

      {/* Métricas */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {metrics.map((m) => {
          const Icon = m.icon
          const up = m.trend > 0
          return (
            <div key={m.label} className="bg-white rounded-2xl p-5 shadow-sm border border-[#E9EDEF]">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: m.color + '18' }}>
                  <Icon size={20} style={{ color: m.color }} />
                </div>
                <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full"
                  style={{ backgroundColor: up ? '#25D36618' : '#FF525218', color: up ? '#25D366' : '#FF5252' }}>
                  {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {Math.abs(m.trend)}%
                </span>
              </div>
              <div className="text-2xl font-bold text-[#111B21] mb-0.5">{m.value}</div>
              <div className="text-xs text-[#667781]">{m.label}</div>
            </div>
          )
        })}
      </div>

      {/* Gráfico + Recentes */}
      <div className="grid xl:grid-cols-3 gap-6">
        {/* Gráfico */}
        <div className="xl:col-span-2 bg-white rounded-2xl p-6 shadow-sm border border-[#E9EDEF]">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-semibold text-[#111B21]">Volume de mensagens</h3>
              <p className="text-xs text-[#667781]">Últimos 7 dias</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-[#667781]">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#25D366]" />Enviadas</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#128C7E]" />Recebidas</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={CHART_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E9EDEF" />
              <XAxis dataKey="dia" tick={{ fontSize: 12, fill: '#667781' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#667781' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
              <Line type="monotone" dataKey="enviadas"  stroke="#25D366" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="recebidas" stroke="#128C7E" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Recentes */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E9EDEF]">
          <div className="flex items-center justify-between p-5 border-b border-[#E9EDEF]">
            <h3 className="font-semibold text-[#111B21]">Conversas recentes</h3>
            <a href="/conversations" className="text-sm font-medium text-[#25D366]">Ver todas</a>
          </div>
          {RECENT.map((c, i) => (
            <div key={i} className={`flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 cursor-pointer transition-colors ${i < RECENT.length - 1 ? 'border-b border-[#E9EDEF]' : ''}`}>
              <Avatar name={c.name} size={40} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-[#111B21]">{c.name}</span>
                  <span className="text-xs text-[#667781]">{c.time}</span>
                </div>
                <p className="text-xs text-[#667781] truncate mt-0.5">{c.msg}</p>
              </div>
              {c.unread > 0 && (
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold bg-[#25D366]">
                  {c.unread}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
