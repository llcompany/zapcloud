import { useState } from 'react'
import { Search, Plus, MessageSquare, Tag, Phone } from 'lucide-react'

const CONTACTS = [
  { id: 1, name: 'João Silva',     phone: '+55 11 99999-0001', email: 'joao@email.com',   tags: ['cliente', 'vip'],   online: true  },
  { id: 2, name: 'Maria Santos',   phone: '+55 11 99999-0002', email: 'maria@email.com',  tags: ['cliente'],           online: false },
  { id: 3, name: 'Carlos Mendes',  phone: '+55 11 99999-0003', email: 'carlos@email.com', tags: ['suporte'],           online: true  },
  { id: 4, name: 'Ana Oliveira',   phone: '+55 11 99999-0004', email: 'ana@email.com',    tags: ['cliente', 'vip'],   online: false },
  { id: 5, name: 'Pedro Costa',    phone: '+55 11 99999-0005', email: 'pedro@email.com',  tags: ['lead'],              online: false },
  { id: 6, name: 'Lucia Ferreira', phone: '+55 11 99999-0006', email: 'lucia@email.com',  tags: ['cliente'],           online: true  },
  { id: 7, name: 'Roberto Lima',   phone: '+55 11 99999-0007', email: 'roberto@email.com',tags: ['suporte', 'urgente'],online: false },
]

const TAG_COLORS = {
  cliente:  { bg: '#25D36618', text: '#128C7E' },
  vip:      { bg: '#ECB22E18', text: '#b45309' },
  suporte:  { bg: '#34B7F118', text: '#0369a1' },
  lead:     { bg: '#8B5CF618', text: '#6d28d9' },
  urgente:  { bg: '#EF444418', text: '#b91c1c' },
}

function Avatar({ name, size = 44, online = false }) {
  const colors = ['#25D366','#128C7E','#075E54','#34B7F1','#ECB22E','#E01E5A']
  const bg = colors[name.charCodeAt(0) % colors.length]
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <div className="w-full h-full rounded-full flex items-center justify-center text-white font-semibold"
        style={{ backgroundColor: bg, fontSize: size * 0.36 }}>
        {name.split(' ').map(n => n[0]).slice(0, 2).join('')}
      </div>
      {online && <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white bg-[#25D366]" />}
    </div>
  )
}

export default function ContactsPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('todos')

  const allTags = ['todos', ...new Set(CONTACTS.flatMap(c => c.tags))]

  const filtered = CONTACTS.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)
    const matchTag    = filter === 'todos' || c.tags.includes(filter)
    return matchSearch && matchTag
  })

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#111B21]">Contatos</h1>
          <p className="text-sm text-[#667781]">{CONTACTS.length} contatos cadastrados</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#25D366] hover:bg-[#128C7E] transition-colors">
          <Plus size={16} /> Novo contato
        </button>
      </div>

      {/* Busca + Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 flex-1 px-4 py-2.5 rounded-xl bg-white border border-[#E9EDEF]">
          <Search size={16} className="text-[#667781]" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou telefone..."
            className="flex-1 text-sm outline-none text-[#111B21] placeholder-[#667781]" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {allTags.map(tag => (
            <button key={tag} onClick={() => setFilter(tag)}
              className="px-3 py-2 rounded-xl text-xs font-medium capitalize transition-all"
              style={filter === tag
                ? { backgroundColor: '#25D366', color: 'white' }
                : { backgroundColor: 'white', color: '#667781', border: '1px solid #E9EDEF' }}>
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Grid de contatos */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(c => (
          <div key={c.id} className="bg-white rounded-2xl p-5 shadow-sm border border-[#E9EDEF] hover:shadow-md transition-shadow">
            <div className="flex items-start gap-3 mb-3">
              <Avatar name={c.name} online={c.online} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-[#111B21] truncate">{c.name}</p>
                <p className="text-xs text-[#667781] flex items-center gap-1 mt-0.5">
                  <Phone size={11} />{c.phone}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {c.tags.map(tag => {
                const style = TAG_COLORS[tag] || { bg: '#F0F2F5', text: '#667781' }
                return (
                  <span key={tag} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full capitalize"
                    style={{ backgroundColor: style.bg, color: style.text }}>
                    <Tag size={9} />{tag}
                  </span>
                )
              })}
            </div>
            <button className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium text-[#25D366] bg-[#25D366]/10 hover:bg-[#25D366]/20 transition-colors">
              <MessageSquare size={15} /> Enviar mensagem
            </button>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-[#667781]">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p>Nenhum contato encontrado</p>
        </div>
      )}
    </div>
  )
}
