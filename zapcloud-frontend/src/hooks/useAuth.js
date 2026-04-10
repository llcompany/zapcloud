import { useState, useEffect, createContext, useContext } from 'react'
import { authAPI } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('zapcloud_user')
    const token  = localStorage.getItem('zapcloud_token')
    if (stored && token) setUser(JSON.parse(stored))
    setLoading(false)
  }, [])

  const login = async (email, password) => {
    const { data } = await authAPI.login({ email, password })
    localStorage.setItem('zapcloud_token',        data.data.accessToken)
    localStorage.setItem('zapcloud_refresh_token', data.data.refreshToken)
    localStorage.setItem('zapcloud_user',          JSON.stringify(data.data.user))
    setUser(data.data.user)
    return data.data.user
  }

  const register = async (name, email, password) => {
    const { data } = await authAPI.register({ name, email, password })
    localStorage.setItem('zapcloud_token',        data.data.accessToken)
    localStorage.setItem('zapcloud_refresh_token', data.data.refreshToken)
    localStorage.setItem('zapcloud_user',          JSON.stringify(data.data.user))
    setUser(data.data.user)
    return data.data.user
  }

  const logout = () => {
    localStorage.removeItem('zapcloud_token')
    localStorage.removeItem('zapcloud_refresh_token')
    localStorage.removeItem('zapcloud_user')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
