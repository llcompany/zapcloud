import { useState } from 'react'
import { ChevronRight, User, Bell, Shield, Link2, CreditCard, Save } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

const SECTIONS = [
  { id: 'profile',       icon: User,       label: 'Perfil',               desc: 'Nome, e-mail e foto' },
  { id: 'notifications', icon: Bell,       label: 'Notificações',          desc: 'Alertas e sons' },
  { id: 'security',      icon: Shield,     label: 'Segurança',             desc: 'Senha e autenticação' },
  { id: 'integrations',  icon: Link2,      label: 'Integrações',           desc: 'Webhooks e APIs' },
  { id: 'billing',       icon: CreditCard, label: 'Faturamento',           desc: 'Plano e pagamento' },
]

export default function SettingsPage() {
  const { user } = useAuth()
  const [active, setActive] = useState('profile')
  const [name, setName]     = useState(user?.name || '')
  const [saved, setSaved]   = useState(false)

  const save = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111B21]">Configurações</h1>
        <p className="text-sm text-[#667781] mt-1">Gerencie sua conta e preferências</p>
      </div>

      <div className="grid md:grid-cols-3 gap-5">
        {/* Menu */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E9EDEF] overflow-hidden h-fit">
          {SECTIONS.map((s, i) => {
            const Icon = s.icon
            return (
              <button key={s.id} onClick={() => setActive(s.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${i < SECTIONS.length - 1 ? 'border-b border-[#E9EDEF]' : ''} ${active === s.id ? 'bg-[#25D366]/10' : 'hover:bg-gray-50'}`}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: active === s.id ? '#25D366' : '#F0F2F5' }}>
                  <Icon size={15} style={{ color: active === s.id ? 'white' : '#667781' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#111B21]">{s.label}</p>
                  <p className="text-xs text-[#667781] truncate">{s.desc}</p>
                </div>
                <ChevronRight size={14} className="text-[#667781] flex-shrink-0" />
              </button>
            )
          })}
        </div>

        {/* Conteúdo */}
        <div className="md:col-span-2 bg-white rounded-2xl shadow-sm border border-[#E9EDEF] p-6">
          {active === 'profile' && (
            <div className="space-y-5">
              <h3 className="font-semibold text-[#111B21]">Perfil da conta</h3>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-[#25D366] flex items-center justify-center text-white font-bold text-xl">
                  {user?.name?.split(' ').map(n => n[0]).slice(0,2).join('') || 'ZC'}
                </div>
                <div>
                  <p className="font-semibold text-[#111B21]">{user?.name}</p>
                  <p className="text-sm text-[#667781]">{user?.email}</p>
                  <button className="text-xs text-[#25D366] mt-1">Alterar foto</button>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#111B21] mb-1.5">Nome</label>
                  <input value={name} onChange={e => setName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-[#E9EDEF] text-sm outline-none focus:border-[#25D366] transition-colors" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#111B21] mb-1.5">E-mail</label>
                  <input defaultValue={user?.email} readOnly
                    className="w-full px-4 py-2.5 rounded-xl border border-[#E9EDEF] text-sm outline-none bg-[#F0F2F5] text-[#667781]" />
                </div>
              </div>
              <button onClick={save}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
                style={{ backgroundColor: saved ? '#128C7E' : '#25D366' }}>
                <Save size={15} />
                {saved ? 'Salvo!' : 'Salvar alterações'}
              </button>
            </div>
          )}

          {active === 'notifications' && (
            <div className="space-y-5">
              <h3 className="font-semibold text-[#111B21]">Notificações</h3>
              {[
                ['Novas mensagens recebidas', true],
                ['Atualizações de status de entrega', true],
                ['Alertas de conta WABA', false],
                ['Relatórios semanais por e-mail', false],
              ].map(([label, def]) => {
                const [on, setOn] = useState(def)
                return (
                  <div key={label} className="flex items-center justify-between py-3 border-b border-[#E9EDEF] last:border-0">
                    <span className="text-sm text-[#111B21]">{label}</span>
                    <button onClick={() => setOn(!on)}
                      className="relative w-10 h-6 rounded-full transition-colors"
                      style={{ backgroundColor: on ? '#25D366' : '#E9EDEF' }}>
                      <span className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all"
                        style={{ left: on ? '22px' : '2px' }} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {(active === 'security' || active === 'integrations' || active === 'billing') && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-14 h-14 rounded-2xl bg-[#F0F2F5] flex items-center justify-center mb-3">
                {active === 'security'     && <Shield     size={24} className="text-[#667781]" />}
                {active === 'integrations' && <Link2      size={24} className="text-[#667781]" />}
                {active === 'billing'      && <CreditCard size={24} className="text-[#667781]" />}
              </div>
              <p className="font-medium text-[#111B21] mb-1">{SECTIONS.find(s => s.id === active)?.label}</p>
              <p className="text-sm text-[#667781]">Em breve disponível na plataforma.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
