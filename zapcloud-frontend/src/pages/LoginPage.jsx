import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, Check, RefreshCw } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

export default function LoginPage() {
  const [tab, setTab]       = useState('login')
  const [form, setForm]     = useState({ name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')
  const { login, register } = useAuth()
  const navigate = useNavigate()

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (tab === 'login') {
        await login(form.email, form.password)
      } else {
        await register(form.name, form.email, form.password)
      }
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.message || 'Erro ao autenticar. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const inputClass = "w-full px-4 py-3 rounded-xl border border-[#E9EDEF] text-sm outline-none transition-all focus:border-[#25D366] bg-white text-[#111B21] placeholder-[#667781]"

  return (
    <div className="min-h-screen flex bg-[#F0F2F5]">
      {/* Painel esquerdo — verde */}
      <div className="hidden lg:flex flex-col items-center justify-center flex-1 p-12"
        style={{ background: 'linear-gradient(135deg, #075E54 0%, #128C7E 50%, #25D366 100%)' }}>
        <div className="text-center text-white max-w-md">
          <div className="w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-8 bg-white/15 shadow-2xl">
            <MessageSquare size={48} color="white" />
          </div>
          <h1 className="text-5xl font-bold mb-4">ZapCloud</h1>
          <p className="text-xl opacity-90 mb-10">Plataforma completa para gerenciar seu WhatsApp Business</p>
          <div className="space-y-4 text-left">
            {['Envio em massa e automações', 'Gestão de contatos e tags', 'Templates aprovados pela Meta', 'Relatórios em tempo real'].map(f => (
              <div key={f} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 bg-white/20">
                  <Check size={13} color="white" />
                </div>
                <span className="opacity-90">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Painel direito — formulário */}
      <div className="flex-1 lg:max-w-md flex flex-col items-center justify-center p-8 bg-white">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 justify-center mb-8">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[#25D366]">
              <MessageSquare size={22} color="white" />
            </div>
            <span className="text-2xl font-bold text-[#111B21]">ZapCloud</span>
          </div>

          <h2 className="text-2xl font-bold mb-1 text-[#111B21]">
            {tab === 'login' ? 'Bem-vindo de volta' : 'Crie sua conta'}
          </h2>
          <p className="text-sm mb-6 text-[#667781]">
            {tab === 'login' ? 'Entre para acessar seu painel' : 'Comece gratuitamente hoje'}
          </p>

          {/* Tabs */}
          <div className="flex rounded-xl p-1 mb-6 bg-[#F0F2F5]">
            {['login', 'cadastro'].map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="flex-1 py-2 rounded-lg text-sm font-medium transition-all"
                style={tab === t
                  ? { backgroundColor: 'white', color: '#075E54', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }
                  : { color: '#667781' }}>
                {t === 'login' ? 'Entrar' : 'Cadastrar'}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {tab === 'cadastro' && (
              <div>
                <label className="block text-sm font-medium mb-1.5 text-[#111B21]">Nome completo</label>
                <input type="text" placeholder="Seu nome" value={form.name} onChange={set('name')} required className={inputClass} />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1.5 text-[#111B21]">E-mail</label>
              <input type="email" placeholder="seu@email.com" value={form.email} onChange={set('email')} required className={inputClass} />
            </div>
            <div>
              <div className="flex justify-between mb-1.5">
                <label className="text-sm font-medium text-[#111B21]">Senha</label>
                {tab === 'login' && <a href="#" className="text-sm text-[#25D366]">Esqueci a senha</a>}
              </div>
              <input type="password" placeholder="••••••••" value={form.password} onChange={set('password')} required className={inputClass} />
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-xl font-semibold text-white text-sm flex items-center justify-center gap-2 transition-all"
              style={{ backgroundColor: loading ? '#128C7E' : '#25D366' }}>
              {loading
                ? <><RefreshCw size={16} className="animate-spin" /> Aguarde...</>
                : tab === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>

          <p className="text-center text-xs mt-6 text-[#667781]">
            Ao continuar você concorda com os{' '}
            <a href="#" className="text-[#25D366]">Termos de Uso</a> e{' '}
            <a href="#" className="text-[#25D366]">Política de Privacidade</a>
          </p>
        </div>
      </div>
    </div>
  )
}
