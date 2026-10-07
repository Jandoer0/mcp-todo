import { useState, useEffect, useCallback } from 'react'
import { authApi, summaryApi, adminApi, healthApi } from '../api/client'

export function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem('token'))
  const [isAdmin, setIsAdmin] = useState(false)
  const [view, setView] = useState(token ? 'tasks' : 'login')

  // Architecture-level cache busting: if the backend build version differs from
  // the one baked into this bundle, reload to pick up the new frontend.
  useEffect(() => {
    healthApi
      .get()
      .then((res) => {
        const serverVersion = res.data?.version
        const clientVersion = import.meta.env.VITE_APP_VERSION
        if (serverVersion && serverVersion !== clientVersion) {
          window.location.reload()
        }
      })
      .catch(() => {})
  }, [])

  // Validate any stored token on load; clear it if invalid so we don't show
  // a broken dashboard.
  useEffect(() => {
    if (!token) {
      setView('login')
      return
    }
    summaryApi
      .get()
      .then(() => setView('tasks'))
      .catch(() => {
        localStorage.removeItem('token')
        setToken(null)
        setView('login')
      })
  }, [token])

  const login = useCallback(async (username, password) => {
    const res = await authApi.login(username, password)
    const t = res.data.access_token
    localStorage.setItem('token', t)
    setToken(t)
    setView('tasks')
  }, [])

  const register = useCallback(
    async (username, password) => {
      await authApi.register(username, password)
      await login(username, password)
    },
    [login],
  )

  const logout = useCallback(() => {
    localStorage.removeItem('token')
    setToken(null)
    setIsAdmin(false)
    setView('login')
    window.location.href = '/'
  }, [])

  const checkAdmin = useCallback(async () => {
    try {
      await adminApi.listUsers()
      setIsAdmin(true)
    } catch {
      setIsAdmin(false)
    }
  }, [])

  useEffect(() => {
    if (token) checkAdmin()
  }, [token, checkAdmin])

  return { token, isAdmin, view, setView, login, register, logout, checkAdmin }
}
