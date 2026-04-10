import { useState, useRef, useEffect } from 'react'
import { Search, Plus, Send, Paperclip, Smile, Phone, Video, MoreVertical, Check, CheckCheck, Clock, ArrowLeft } from 'lucide-react'

const CONTACTS = [
  { id: 1, name: 'João Silva',     phone: '+55 11 99999-0001', lastMsg: 'Preciso de ajuda com meu pedido', time: '14:32', unread: 2, online: true },
  { id: 2, name: 'Maria Santos',   phone: '+55 11 99999-0002', lastMsg: 'Obrigada pelo atendimento! 😊',   time: '13:15', unread: 0, online: false },
  { id: 3, name: 'Carlos Mendes',  phone: '+55 11 99999-0003', lastMsg: 'Quando chega meu produto?',       time: '11:48', unread: 5, online: true },
  { id: 4, name: 'Ana Oliveira',   phone: '+55 11 99999-0004', lastMsg: 'Perfeito, muito obrigada!',       time: 'Ontem', unread: 0, online: false },
  { id: 5, name: 'Pedro Costa',    phone: '+55 11 99999-0005', lastMsg: 'Ok, aguardo o retorno',           time: 'Ontem', unread: 0, online: false },
  { id: 6, name: 'Lucia Ferreira', phone: '+55 11 99999-0006', lastMsg: 'Entrega no interior?',            time: 'Seg',   unread: 1, online: true },
]

const MESSAGES_MOCK = {
  1: [
    { id: 1, from: 'them', text: 'Olá! Preciso de ajuda com meu pedido #12345', time: '14:20', status: 'read' },
    { id: 2, from: 'me',   text: 'Olá João! Pode me passar mais detalhes?',     time: '14:21', status: 'read' },
    { id: 3, from: 'them', text: 'O produto veio errado, pedi azul e veio vermelho 😕', time: '14:25', status: 'read' },
    { id: 4, from: 'me',   text: 'Me desculpe pelo transtorno! Vou resolver isso agora.',  time: '14:28', status: 'read' },
    { id: 5, from: 'them', text: 'Preciso de ajuda com meu pedido', time: '14:32', status: 'delivered' },
  ],
  3: [
    { id: 1, from: 'them', text: 'Fiz um pedido há 5 dias, pedido #98765', time: '11:30', status: 'read' },
    { id: 2, from: 'me',   text: 'Vou verificar o status agora!',           time: '11:35', status: 'read' },
    { id: 3, from: 'them', text: 'Quando chega meu produto?', time: '11:48', status: 'read' },
  ],
}

function Avatar({ name, size = 40, online = false }) {
  const colors = ['#25D366','#128C7E','#075E54','#34B7F1','#ECB22E','#E01E5A']
  const bg = colors[name.charCodeAt(0) % colors.length]
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <div className="w-full h-full rounded-full flex items-center justify-center text-white font-semibold"
        style={{ backgroundColor: bg, fontSize: size * 0.38 }}>
        {name.split(' ').map(n => n[0]).slice(0, 2).join('')}
      </div>
      {online && <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white bg-[#25D366]" />}
    </div>
  )
}

function StatusIcon({ status }) {
  if (status === 'pending')   return <Clock    size={13} className="text-gray-400" />
  if (status === 'sent')      return <Check    size={13} className="text-gray-400" />
  if (status === 'delivered') return <CheckCheck size={13} className="text-gray-400" />
  if (status === 'read')      return <CheckCheck size={13} className="text-[#34B7F1]" />
  return null
}

export default function ConversationsPage() {
  const [selected, setSelected]   = useState(CONTACTS[0])
  const [messages, setMessages]   = useState(MESSAGES_MOCK[1] || [])
  const [input, setInput]         = useState('')
  const [search, setSearch]       = useState('')
  const [view, setView]           = useState('list') // mobile: 'list' | 'chat'
  const bottomRef = useRef(null)

  const pick = (c) => {
    setSelected(c)
    setMessages(MESSAGES_MOCK[c.id] || [])
    setView('chat')
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = () => {
    if (!input.trim()) return
    setMessages(prev => [...prev, {
      id: Date.now(), from: 'me', text: input,
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      status: 'sent',
    }])
    setInput('')
  }

  const filtered = CONTACTS.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)
  )

  return (
    <div className="flex h-full overflow-hidden">
      {/* Lista */}
      <div className={`w-full md:w-80 xl:w-96 flex-shrink-0 border-r border-[#E9EDEF] flex flex-col bg-white ${view === 'chat' ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-4 border-b border-[#E9EDEF]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-lg text-[#111B21]">Conversas</h2>
            <button className="w-9 h-9 rounded-xl flex items-center justify-center bg-[#25D366]/10">
              <Plus size={18} className="text-[#25D366]" />
            </button>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F0F2F5]">
            <Search size={16} className="text-[#667781]" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar contato..."
              className="flex-1 bg-transparent text-sm outline-none text-[#111B21] placeholder-[#667781]" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map(c => (
            <div key={c.id} onClick={() => pick(c)}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-[#E9EDEF]"
              style={{ backgroundColor: selected?.id === c.id ? '#25D36610' : 'transparent' }}>
              <Avatar name={c.name} size={46} online={c.online} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-[#111B21]">{c.name}</span>
                  <span className="text-xs" style={{ color: c.unread ? '#25D366' : '#667781' }}>{c.time}</span>
                </div>
                <p className="text-xs text-[#667781] truncate mt-0.5">{c.lastMsg}</p>
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

      {/* Chat */}
      <div className={`flex-1 flex flex-col ${view === 'list' ? 'hidden md:flex' : 'flex'}`}>
        {selected ? (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#E9EDEF] bg-white shadow-sm">
              <button className="md:hidden p-1" onClick={() => setView('list')}>
                <ArrowLeft size={20} className="text-[#667781]" />
              </button>
              <Avatar name={selected.name} size={40} online={selected.online} />
              <div className="flex-1">
                <p className="font-semibold text-sm text-[#111B21]">{selected.name}</p>
                <p className="text-xs" style={{ color: selected.online ? '#25D366' : '#667781' }}>
                  {selected.online ? 'online' : selected.phone}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {[Phone, Video, Search, MoreVertical].map((Icon, i) => (
                  <button key={i} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors">
                    <Icon size={18} className="text-[#667781]" />
                  </button>
                ))}
              </div>
            </div>

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1 bg-[#F0F2F5]"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%2325D366' fill-opacity='0.04'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/svg%3E")`,
              }}>
              {messages.map(m => (
                <div key={m.id} className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'} mb-1`}>
                  <div className="max-w-xs lg:max-w-md px-3 py-2 shadow-sm"
                    style={{
                      backgroundColor: m.from === 'me' ? '#DCF8C6' : 'white',
                      borderRadius: m.from === 'me' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    }}>
                    <p className="text-sm text-[#111B21]">{m.text}</p>
                    <div className={`flex items-center gap-1 mt-0.5 ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                      <span className="text-xs text-[#667781]">{m.time}</span>
                      {m.from === 'me' && <StatusIcon status={m.status} />}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-[#E9EDEF] bg-white">
              <div className="flex items-center gap-2">
                <button className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-gray-100">
                  <Paperclip size={18} className="text-[#667781]" />
                </button>
                <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#F0F2F5]">
                  <input value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && send()}
                    placeholder="Digite uma mensagem"
                    className="flex-1 bg-transparent text-sm outline-none text-[#111B21] placeholder-[#667781]" />
                  <button><Smile size={18} className="text-[#667781]" /></button>
                </div>
                <button onClick={send}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white shadow-md transition-all active:scale-95"
                  style={{ backgroundColor: input.trim() ? '#25D366' : '#667781' }}>
                  <Send size={18} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-[#F0F2F5]">
            <p className="text-[#667781]">Selecione uma conversa para começar</p>
          </div>
        )}
      </div>
    </div>
  )
}
