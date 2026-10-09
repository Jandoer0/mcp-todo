import axios from 'axios'

export const API_URL = '/api'

const token = () => localStorage.getItem('token')

// Single axios instance. The request interceptor attaches the JWT automatically
// so individual calls never have to manage the Authorization header manually.
export const api = axios.create()
api.interceptors.request.use((config) => {
  const t = token()
  if (t) config.headers.Authorization = `Bearer ${t}`
  return config
})

export const authApi = {
  login: (username, password) =>
    api.post(`${API_URL}/auth/login`, { username, password }),
  register: (username, password) =>
    api.post(`${API_URL}/auth/register`, { username, password }),
  registrationStatus: () => api.get(`${API_URL}/auth/registration-status`),
}

export const tasksApi = {
  list: (status) =>
    api.get(`${API_URL}/tasks`, { params: status ? { status } : {} }),
  create: (data) => api.post(`${API_URL}/tasks`, data),
  update: (id, data) => api.put(`${API_URL}/tasks/${id}`, data),
  remove: (id) => api.delete(`${API_URL}/tasks/${id}`),
  cycleSkip: (id) => api.post(`${API_URL}/tasks/${id}/cycle/skip`),
  cycleStop: (id) => api.post(`${API_URL}/tasks/${id}/cycle/stop`),
  cycleHistory: (id) => api.get(`${API_URL}/tasks/${id}/cycle/history`),
}

export const summaryApi = {
  get: () => api.get(`${API_URL}/summary`),
}

export const adminApi = {
  listUsers: () => api.get(`${API_URL}/admin/users`),
  createUser: (data) => api.post(`${API_URL}/admin/users`, data),
  updateUser: (id, data) => api.put(`${API_URL}/admin/users/${id}`, data),
  deleteUser: (id) => api.delete(`${API_URL}/admin/users/${id}`),
  getSettings: () => api.get(`${API_URL}/admin/settings`),
  setRegistration: (enabled) =>
    api.put(`${API_URL}/admin/settings/allow_registration?enabled=${enabled}`),
  mcpToken: {
    regenerate: (id) => api.post(`${API_URL}/admin/users/${id}/mcp-token`),
    revoke: (id) => api.delete(`${API_URL}/admin/users/${id}/mcp-token`),
  },
}

export const listsApi = {
  list: () => api.get(`${API_URL}/lists`),
  create: (data) => api.post(`${API_URL}/lists`, data),
  update: (id, data) => api.put(`${API_URL}/lists/${id}`, data),
  remove: (id) => api.delete(`${API_URL}/lists/${id}`),
}

export const tagsApi = {
  list: () => api.get(`${API_URL}/tags`),
  create: (data) => api.post(`${API_URL}/tags`, data),
  update: (id, data) => api.put(`${API_URL}/tags/${id}`, data),
  remove: (id) => api.delete(`${API_URL}/tags/${id}`),
}

export const healthApi = {
  get: () => api.get(`${API_URL}/health`, { headers: { 'Cache-Control': 'no-store' } }),
}
