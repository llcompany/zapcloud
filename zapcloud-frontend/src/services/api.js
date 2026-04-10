import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  timeout: 10000,
})

// Injeta token em toda requisição
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('zapcloud_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Redireciona para login se token expirar
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('zapcloud_token')
      localStorage.removeItem('zapcloud_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ── Auth ─────────────────────────────────────────────────────────────────────
export const authAPI = {
  register: (data) => api.post('/api/auth/register', data),
  login:    (data) => api.post('/api/auth/login', data),
  me:       ()     => api.get('/api/auth/me'),
  refresh:  (refreshToken) => api.post('/api/auth/refresh', { refreshToken }),
}

// ── Meta / Embedded Signup ───────────────────────────────────────────────────
export const metaAPI = {
  getAuthUrl:    ()   => api.get('/api/meta/auth-url'),
  listAccounts:  ()   => api.get('/api/meta/accounts'),
  disconnect:    (id) => api.delete(`/api/meta/accounts/${id}`),
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────
export const whatsappAPI = {
  sendText:     (wabaId, data) => api.post(`/api/whatsapp/${wabaId}/messages/text`, data),
  sendTemplate: (wabaId, data) => api.post(`/api/whatsapp/${wabaId}/messages/template`, data),
  getMessages:  (wabaId, contactId, params) =>
    api.get(`/api/whatsapp/${wabaId}/contacts/${contactId}/messages`, { params }),
}

// ── Contatos ─────────────────────────────────────────────────────────────────
export const contactsAPI = {
  list:   (wabaId, params) => api.get(`/api/whatsapp/${wabaId}/contacts`, { params }),
  upsert: (wabaId, data)   => api.put(`/api/whatsapp/${wabaId}/contacts`, data),
  get:    (wabaId, id)     => api.get(`/api/whatsapp/${wabaId}/contacts/${id}`),
}

export default api
