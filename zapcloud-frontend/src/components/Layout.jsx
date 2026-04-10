import { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { MessageSquare, BarChart2, Users, Link2, Settings, LogOut, Bell, Menu, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

const NAV = [
  { to: '/dashboard',     icon: BarChart2,     label: 'Dashboard' },
  { to: '/conversations', icon: MessageSquare, label: 'Conversas' },
  { to: '/contacts',      icon: Users,         label: 'Contatos' },
  { to: '/connect',       icon: Link2,         label: 'Conectar WhatsApp' },
  { to: '/settings',      icon: Settings,      label: 'Configurações' },
]

function Avatar({ name, size = 36 }) {
  const colors = ['#25D366','#128C7E','#075E54','#34B7F1','#ECB22E']
  const bg = colors[name.charCodeAt(0) % colors.length]
  return (
    <div className="rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: bg, fontSize: size * 0.38 }}>
      {name.split(' ').map(n => n[0]).slice(0, 2).join('')}
    </div>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const [open, setOpen]  = useState(false)
  const location = useLocation()
  const isConversations = location.pathname === '/conversations'

  return (
    <div className="flex h-screen overflow-hidden bg-[#F0F2F5]">
      {/* Mobile overlay */}
      {open && <div className="fixed inset-0 bg-black/40 z-20 md:hidden" onClick={() => setOpen(false)} />}

      {/* Sidebar */}
      <aside className={`fixed md:static inset-y-0 left-0 z-30 w-64 flex flex-col bg-white border-r border-[#E9EDEF] shadow-sm transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        {/* Logo */}
        <div className="flex items-center justify-between p-5 border-b border-[#E9EDEF]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-[#25D366]">
              <MessageSquare size={18} color="white" />
            </div>
            <span className="font-bold text-lg text-[#111B21]">ZapCloud</span>
          </div>
          <button className="md:hidden" onClick={() => setOpen(false)}>
            <X size={20} className="text-[#667781]" />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-[#25D366]/10 text-[#075E54]'
                    : 'text-[#667781] hover:bg-gray-50 hover:text-[#111B21]'
                }`
              }>
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User info */}
        <div className="p-4 border-t border-[#E9EDEF]">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#111B21] truncate">{user.name}</p>
              <p className="text-xs text-[#667781] truncate">{user.email}</p>
            </div>
            <button onClick={logout} title="Sair"
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
              <LogOut size={16} className="text-[#667781]" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-[#E9EDEF] shadow-sm flex-shrink-0">
          <button className="md:hidden p-2 rounded-lg hover:bg-gray-100" onClick={() => setOpen(true)}>
            <Menu size={20} className="text-[#111B21]" />
          </button>
          <div className="hidden md:block">
            <h2 className="font-semibold text-[#111B21]">
              {NAV.find(n => location.pathname.startsWith(n.to))?.label ?? 'ZapCloud'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button className="relative w-9 h-9 rounded-full flex items-center justify-center hover:bg-gray-100">
              <Bell size={18} className="text-[#667781]" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#25D366]" />
            </button>
            <Avatar name={user.name} size={34} />
          </div>
        </header>

        {/* Page content */}
        <main className={`flex-1 ${isConversations ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
