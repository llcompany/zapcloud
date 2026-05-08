import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, Plus, Send, Paperclip, Smile, Phone, Video, MoreVertical, Check, CheckCheck, Clock, ArrowLeft, Loader, MessageSquare } from 'lucide-react'
import { metaAPI, contactsAPI, whatsappAPI } from '../services/api'

function Avatar({ name = '?', size = 40, online = false }) {
  const colors = ['#25D366','#128C7E','#075E54','#34B7F1','#ECB22E','#E01E5A']
  const bg = colors[(name || '?').charCodeAt(0) % colors.length]
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <div className="w-full h-full rounded-full flex items-center justify-center text-white font-semibold"
        style={{ backgroundColor: bg, fontSize: size * 0.38 }}>
        {(name || '?').split(' ').map(n => n[0]).slice(0, 2).join('')}
      </div>
      {online && <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white bg-[#25D366]" />}
    </div>
  )
}

function StatusIcon({ status }) {
  if (status === 'PENDING')   return <Clock      size={13} className="text-gray-400" />
  if (status === 'SENT')      return <Check      size={13} className="text-gray-400" />
  if (status === 'DELIVERED') return <CheckCheck size={13} className="text-gray-400" />
  if (status === 'READ')      return <CheckCheck size={13} className="text-[#34B7F1]" />
  return null
}

function formatTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function getMessagePreview(contact) {
  const lastMsg = contact.messages?.[0]
  if (!lastMsg) return 'Nenhuma mensagem'
  if (lastMsg.type === 'TEXT') return lastMsg.content?.text || ''
  if (lastMsg.type === 'IMAGE') return '📷 Imagem'
  if (lastMsg.type === 'AUDIO') return '🎵 Áudio'
  if (lastMsg.type === 'VIDEO') return '🎥 Vídeo'
  if (lastMsg.type === 'DOCUMENT') return '📄 Documento'
  if (lastMsg.type === 'TEMPLATE') return `📋 ${lastMsg.content?.templateName || 'Template'}`
  return 'Mensagem'
}

export default function ConversationsPage() {
  const [wabaId, setWabaId]         = useState(null)
  const [contacts, setContacts]     = useState([])
  const [loadingContacts, setLoadingContacts] = useState(true)
  const [selected, setSelected]     = useState(null)
  const [messages, setMessages]     = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [input, setInput]           = useState('')
  const [sending, setSending]       = useState(false)
  const [search, setSearch]         = useState('')
  const [view, setView]             = useState('list') // mobile: 'list' | 'chat'
  const bottomRef = useRef(null)
  const pollRef   = useRef(null)

  // Buscar wabaAccountId
  useEffect(() => {
    metaAPI.listAccounts()
      .then(r => {
        const acc = r.data.data?.[0]
        if (acc) setWabaId(acc.id)
      })
      .catch(() => {})
  }, [])

  // Buscar contatos quando wabaId disponível
  const fetchContacts = useCallback(() => {
    if (!wabaId) return
    contactsAPI.list(wabaId, { limit: 100, search: search || undefined })
      .then(r => setContacts(r.data.data?.contacts || []))
      .catch(() => {})
      .finally(() => setLoadingContacts(false))
  }, [wabaId, search])

  useEffect(() => {
    setLoadingContacts(true)
    fetchContacts()
  }, [fetchContacts])

  // Polling de contatos a cada 10s para atualizar lista
  useEffect(() => {
    const interval = setInterval(() => fetchContacts(), 10000)
    return () => clearInterval(interval)
  }, [fetchContacts])

  // Buscar mensagens do contato selecionado
  const fetchMessages = useCallback(() => {
    if (!wabaId || !selected) return
    whatsappAPI.getMessages(wabaId, selected.id, { limit: 100 })
      .then(r => {
        const msgs = r.data.data?.messages || []
        setMessages([...msgs].reverse()) // API retorna desc, inverter para exibir cronológico
      })
      .catch(() => {})
  }, [wabaId, selected])

  useEffect(() => {
    if (!selected) return
    setLoadingMsgs(true)
    whatsappAPI.getMessages(wabaId, selected.id, { limit: 100 })
      .then(r => {
        const msgs = r.data.data?.messages || []
        setMessages([...msgs].reverse())
      })
      .catch(() => {})
      .finally(() => setLoadingMsgs(false))
  }, [selected, wabaId])

  // Polling de mensagens a cada 5s quando há contato selecionado
  useEffect(() => {
    clearInterval(pollRef.current)
    if (!selected) return
    pollRef.current = setInterval(() => fetchMessages(), 5000)
    return () => clearInterval(pollRef.current)
  }, [selected, fetchMessages])

  // Scroll para o final quando chegam novas mensagens
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const pick = (c) => {
    setSelected(c)
    setMessages([])
    setView('chat')
  }

  const send = async () => {
    if (!input.trim() || !selected || !wabaId) return
    const text = input.trim()
    setInput('')
    setSending(true)
    try {
      await whatsappAPI.sendText(wabaId, { to: selected.phone, message: text })
      // Recarregar mensagens após envio
      await fetchMessages()
      fetchContacts()
    } catch (err) {
      console.error('Erro ao enviar mensagem:', err)
      alert('Erro ao enviar mensagem. Verifique o console.')
    } finally {
      setSending(false)
    }
  }

  const filtered = contacts.filter(c =>
    (c.name || c.phone).toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search)
  )

  if (!wabaId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-[#667781]">
        <MessageSquare size={48} className="opacity-30" />
        <p className="text-sm">Nenhuma conta WhatsApp conectada.</p>
        <a href="/connect" className="text-[#25D366] text-sm underline">Conectar agora</a>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Lista de contatos ── */}
      <div className={`w-full md:w-80 xl:w-96 flex-shrink-0 border-r border-[#E9EDEF] flex flex-col bg-white ${view === 'chat' ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-4 border-b border-[#E9EDEF]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-lg text-[#111B21]">Conversas</h2>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F0F2F5]">
            <Search size={16} className="text-[#667781]" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar contato..."
              className="flex-1 bg-transparent text-sm outline-none text-[#111B21] placeholder-[#667781]" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingContacts ? (
            <div className="flex items-center justify-center py-16 text-[#667781]">
              <Loader size={20} className="animate-spin mr-2" /> Carregando...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[#667781] px-6 text-center">
              <MessageSquare size={36} className="opacity-30 mb-2" />
              <p className="text-sm">Nenhuma conversa ainda.</p>
              <p className="text-xs mt-1 opacity-70">As mensagens recebidas pelo WhatsApp aparecerão aqui.</p>
            </div>
          ) : (
            filtered.map(c => {
              const lastMsg = c.messages?.[0]
              return (
                <div key={c.id} onClick={() => pick(c)}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-[#E9EDEF]"
                  style={{ backgroundColor: selected?.id === c.id ? '#25D36610' : 'transparent' }}>
                  <Avatar name={c.name || c.phone} size={46} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-[#111B21] truncate">{c.name || c.phone}</span>
                      <span className="text-xs text-[#667781] flex-shrink-0 ml-1">
                        {formatTime(lastMsg?.createdAt || c.lastSeenAt)}
                      </span>
                    </div>
                    <p className="text-xs text-[#667781] truncate mt-0.5">{getMessagePreview(c)}</p>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── Área do chat ── */}
      <div className={`flex-1 flex flex-col ${view === 'list' ? 'hidden md:flex' : 'flex'}`}>
        {selected ? (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#E9EDEF] bg-white shadow-sm">
              <button className="md:hidden p-1" onClick={() => setView('list')}>
                <ArrowLeft size={20} className="text-[#667781]" />
              </button>
              <Avatar name={selected.name || selected.phone} size={40} />
              <div className="flex-1">
                <p className="font-semibold text-sm text-[#111B21]">{selected.name || selected.phone}</p>
                <p className="text-xs text-[#667781]">{selected.name ? selected.phone : ''}</p>
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
              {loadingMsgs ? (
                <div className="flex items-center justify-center py-10 text-[#667781]">
                  <Loader size={20} className="animate-spin mr-2" /> Carregando mensagens...
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center py-10 text-[#667781]">
                  <p className="text-sm">Nenhuma mensagem ainda.</p>
                </div>
              ) : (
                messages.map(m => {
                  const isMe = m.direction === 'OUTBOUND'
                  const text = m.type === 'TEXT'
                    ? m.content?.text
                    : m.type === 'TEMPLATE'
                      ? `[Template: ${m.content?.templateName}]`
                      : m.type === 'IMAGE' ? '📷 Imagem'
                      : m.type === 'AUDIO' ? '🎵 Áudio'
                      : m.type === 'VIDEO' ? '🎥 Vídeo'
                      : m.type === 'DOCUMENT' ? '📄 Documento'
                      : '[Mensagem]'
                  return (
                    <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} mb-1`}>
                      <div className="max-w-xs lg:max-w-md px-3 py-2 shadow-sm"
                        style={{
                          backgroundColor: isMe ? '#DCF8C6' : 'white',
                          borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                        }}>
                        <p className="text-sm text-[#111B21]">{text}</p>
                        <div className={`flex items-center gap-1 mt-0.5 ${isMe ? 'justify-end' : 'justify-start'}`}>
                          <span className="text-xs text-[#667781]">{formatTime(m.createdAt)}</span>
                          {isMe && <StatusIcon status={m.status} />}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
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
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                    placeholder="Digite uma mensagem"
                    disabled={sending}
                    className="flex-1 bg-transparent text-sm outline-none text-[#111B21] placeholder-[#667781]" />
                  <button><Smile size={18} className="text-[#667781]" /></button>
                </div>
                <button onClick={send} disabled={sending || !input.trim()}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white shadow-md transition-all active:scale-95 disabled:opacity-50"
                  style={{ backgroundColor: input.trim() && !sending ? '#25D366' : '#667781' }}>
                  {sending ? <Loader size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-[#F0F2F5] gap-3 text-[#667781]">
            <MessageSquare size={48} className="opacity-30" />
            <p>Selecione uma conversa para começar</p>
          </div>
        )}
      </div>
    </div>
  )
}
