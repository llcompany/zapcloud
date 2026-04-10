import { useState, useEffect } from 'react'
import { Check, ChevronRight, Smartphone, RefreshCw, Wifi, MessageSquare, Trash2, Plus } from 'lucide-react'
import { metaAPI } from '../services/api'

const STEPS = [
  { title: 'Acesse o Meta for Developers', desc: 'Acesse developers.facebook.com e faça login com sua conta Meta/Facebook.', icon: '🌐' },
  { title: 'Crie um App de Negócios',      desc: "Clique em 'Criar app', selecione 'Negócios' e preencha as informações do app.", icon: '📱' },
  { title: 'Configure o WhatsApp',         desc: "No painel do app, adicione o produto 'WhatsApp' e siga o assistente.", icon: '⚙️' },
  { title: 'Autorize o ZapCloud',          desc: "Clique em 'Conectar conta' abaixo para abrir o popup de autorização da Meta.", icon: '🔗' },
]

export default function ConnectPage() {
  const [step, setStep]           = useState(0)
  const [accounts, setAccounts]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    metaAPI.listAccounts()
      .then(r => setAccounts(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const { data } = await metaAPI.getAuthUrl()
      // Abre popup de Embedded Signup
      const popup = window.open(data.data.authUrl, 'MetaSignup', 'width=600,height=700')
      // Listener para quando o popup fechar
      const check = setInterval(() => {
        if (popup?.closed) {
          clearInterval(check)
          setConnecting(false)
          // Recarregar lista de contas
          metaAPI.listAccounts().then(r => setAccounts(r.data.data || []))
        }
      }, 1000)
    } catch {
      setConnecting(false)
    }
  }

  const handleDisconnect = async (id) => {
    if (!confirm('Deseja desconectar esta conta?')) return
    await metaAPI.disconnect(id).catch(() => {})
    setAccounts(prev => prev.filter(a => a.id !== id))
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111B21]">Conectar WhatsApp Business</h1>
        <p className="text-sm text-[#667781] mt-1">Vincule sua conta WABA via Embedded Signup da Meta</p>
      </div>

      {/* Contas conectadas */}
      {!loading && accounts.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-[#E9EDEF]">
          <div className="flex items-center justify-between p-5 border-b border-[#E9EDEF]">
            <h3 className="font-semibold text-[#111B21]">Contas conectadas</h3>
            <button onClick={handleConnect} className="flex items-center gap-1.5 text-sm font-medium text-[#25D366]">
              <Plus size={15} /> Adicionar
            </button>
          </div>
          {accounts.map(acc => (
            <div key={acc.id} className="flex items-center gap-3 px-5 py-4 border-b border-[#E9EDEF] last:border-0">
              <div className="w-11 h-11 rounded-xl bg-[#25D366] flex items-center justify-center flex-shrink-0">
                <MessageSquare size={22} color="white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-[#111B21] truncate">{acc.displayName}</p>
                <p className="text-xs text-[#667781]">WABA ID: {acc.wabaId}</p>
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full mt-1 bg-[#25D366]/10 text-[#25D366]">
                  <Wifi size={10} /> Ativo
                </span>
              </div>
              <button onClick={() => handleDisconnect(acc.id)}
                className="p-2 rounded-lg hover:bg-red-50 text-[#667781] hover:text-red-500 transition-colors">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Passos */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#E9EDEF]">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-[#111B21]">Progresso de configuração</span>
          <span className="text-sm font-semibold text-[#25D366]">{Math.min(step, 4)}/4</span>
        </div>
        <div className="w-full h-2 rounded-full bg-[#F0F2F5] mb-5">
          <div className="h-2 rounded-full transition-all duration-500 bg-[#25D366]"
            style={{ width: `${(Math.min(step, 4) / 4) * 100}%` }} />
        </div>
        <div className="space-y-3">
          {STEPS.map((s, i) => {
            const done   = i < step
            const active = i === step
            return (
              <div key={i} onClick={() => i <= step && setStep(i)}
                className="flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer"
                style={{
                  borderColor: active ? '#25D366' : '#E9EDEF',
                  borderWidth: active ? 2 : 1,
                  opacity: i > step ? 0.45 : 1,
                }}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0"
                  style={{ backgroundColor: done ? '#25D366' : active ? '#25D366/10' : '#F0F2F5' }}>
                  {done ? <Check size={18} color="white" /> : s.icon}
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm text-[#111B21] mb-0.5">Passo {i+1}: {s.title}</p>
                  <p className="text-xs text-[#667781] leading-relaxed">{s.desc}</p>
                </div>
                {active && (
                  <button onClick={e => { e.stopPropagation(); setStep(i+1) }}
                    className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white bg-[#25D366] flex-shrink-0">
                    Próximo <ChevronRight size={12} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Botão conectar */}
      <button onClick={handleConnect} disabled={connecting}
        className="w-full py-4 rounded-2xl font-semibold text-white flex items-center justify-center gap-3 transition-all shadow-md"
        style={{ backgroundColor: step >= 3 ? '#25D366' : '#667781' }}>
        {connecting
          ? <><RefreshCw size={18} className="animate-spin" /> Abrindo autorização Meta...</>
          : <><Smartphone size={18} /> Conectar conta WhatsApp</>}
      </button>
      <p className="text-center text-xs text-[#667781]">🔒 Seus dados são protegidos. Nenhuma senha é armazenada.</p>
    </div>
  )
}
