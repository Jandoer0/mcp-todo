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
  me: () => api.get(`${API_URL}/auth/me`),
  // Локализация и региональные настройки профиля (ТЗ «Многоязычность» §3).
  updateProfile: (data) => api.put(`${API_URL}/auth/profile`, data),
}

export const currenciesApi = {
  list: () => api.get(`${API_URL}/currencies`),
  create: (data) => api.post(`${API_URL}/currencies`, data),
  update: (id, data) => api.put(`${API_URL}/currencies/${id}`, data),
  remove: (id) => api.delete(`${API_URL}/currencies/${id}`),
  reorder: (ids) => api.post(`${API_URL}/currencies/reorder`, { ids }),
}

export const boardsApi = {
  list: () => api.get(`${API_URL}/boards`),
  create: (data) => api.post(`${API_URL}/boards`, data),
  update: (id, data) => api.put(`${API_URL}/boards/${id}`, data),
  remove: (id) => api.delete(`${API_URL}/boards/${id}`),
  webhook: {
    get: (boardId) => api.get(`${API_URL}/boards/${boardId}/webhook`),
    put: (boardId, data) => api.put(`${API_URL}/boards/${boardId}/webhook`, data),
    remove: (boardId) => api.delete(`${API_URL}/boards/${boardId}/webhook`),
    test: (boardId) => api.post(`${API_URL}/boards/${boardId}/webhook/test`),
  },
  budget: (boardId) => api.get(`${API_URL}/boards/${boardId}/budget`),
  cashflow: (boardId) => api.get(`${API_URL}/boards/${boardId}/cashflow`),
  export: (boardId) => api.get(`${API_URL}/boards/${boardId}/export`),
  importBoard: (boardId, body) => api.post(`${API_URL}/boards/${boardId}/import`, body),
}

export const tasksApi = {
  list: (boardId, status) =>
    api.get(`${API_URL}/tasks`, {
      params: { board_id: boardId, ...(status ? { status } : {}) },
    }),
  create: (data) => api.post(`${API_URL}/tasks`, data),
  update: (id, data) => api.put(`${API_URL}/tasks/${id}`, data),
  remove: (id) => api.delete(`${API_URL}/tasks/${id}`),
  cycleSkip: (id) => api.post(`${API_URL}/tasks/${id}/cycle/skip`),
  cycleStop: (id) => api.post(`${API_URL}/tasks/${id}/cycle/stop`),
  cycleComplete: (id, data) => api.post(`${API_URL}/tasks/${id}/cycle/complete`, data),
  cycleHistory: (id) => api.get(`${API_URL}/tasks/${id}/cycle/history`),
  cycleLogUpdate: (taskId, logId, data) => api.patch(`${API_URL}/tasks/${taskId}/cycle/history/${logId}`, data),
  changes: (id) => api.get(`${API_URL}/tasks/${id}/changes`),
  move: (id, boardId) => api.post(`${API_URL}/tasks/${id}/move`, { board_id: boardId }),
  // Канбан DnD (ТЗv2 §1.4): один запрос — колонка + дробная позиция вставки.
  reorder: (id, list, position) => api.patch(`${API_URL}/tasks/${id}/reorder`, { list, position }),
}

export const summaryApi = {
  get: (boardId) =>
    api.get(`${API_URL}/summary`, { params: { board_id: boardId } }),
}

export const adminApi = {
  listUsers: () => api.get(`${API_URL}/admin/users`),
  createUser: (data) => api.post(`${API_URL}/admin/users`, data),
  updateUser: (id, data) => api.put(`${API_URL}/admin/users/${id}`, data),
  deleteUser: (id) => api.delete(`${API_URL}/admin/users/${id}`),
  getSettings: () => api.get(`${API_URL}/admin/settings`),
  updateSettings: (data) => api.put(`${API_URL}/admin/settings`, data),
  getStats: () => api.get(`${API_URL}/admin/stats`),
  setRegistration: (enabled) =>
    api.put(`${API_URL}/admin/settings/allow_registration?enabled=${enabled}`),
  mcpToken: {
    regenerate: (id) => api.post(`${API_URL}/admin/users/${id}/mcp-token`),
    revoke: (id) => api.delete(`${API_URL}/admin/users/${id}/mcp-token`),
  },
  webhooks: {
    list: () => api.get(`${API_URL}/admin/webhooks`),
  },
  setDbSizeLimit: (mb) =>
    api.put(`${API_URL}/admin/settings/db_size_limit_mb?limit_mb=${mb}`),
}

export const listsApi = {
  list: (boardId) =>
    api.get(`${API_URL}/lists`, { params: { board_id: boardId } }),
  create: (boardId, data) =>
    api.post(`${API_URL}/lists`, data, { params: { board_id: boardId } }),
  update: (boardId, id, data) =>
    api.put(`${API_URL}/lists/${boardId}/${id}`, data),
  remove: (boardId, id) => api.delete(`${API_URL}/lists/${boardId}/${id}`),
}

export const tagsApi = {
  list: (boardId) =>
    api.get(`${API_URL}/tags`, { params: { board_id: boardId } }),
  update: (boardId, id, data) =>
    api.put(`${API_URL}/tags/${boardId}/${id}`, data),
}

export const healthApi = {
  get: () => api.get(`${API_URL}/health`, { headers: { 'Cache-Control': 'no-store' } }),
}
