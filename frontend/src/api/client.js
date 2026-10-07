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
}

export const summaryApi = {
  get: () => api.get(`${API_URL}/summary`),
}

export const adminApi = {
  listUsers: () => api.get(`${API_URL}/admin/users`),
  updateRole: (id, role) => api.put(`${API_URL}/admin/users/${id}?role=${role}`),
  deleteUser: (id) => api.delete(`${API_URL}/admin/users/${id}`),
  getSettings: () => api.get(`${API_URL}/admin/settings`),
  setRegistration: (enabled) =>
    api.put(`${API_URL}/admin/settings/allow_registration?enabled=${enabled}`),
}

export const healthApi = {
  get: () => api.get(`${API_URL}/health`, { headers: { 'Cache-Control': 'no-store' } }),
}
