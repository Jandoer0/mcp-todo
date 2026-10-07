import { useState, useEffect, useCallback } from 'react'
import { authApi, summaryApi, adminApi, healthApi } from '../api/client'

export function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem('token'))
  const [isAdmin, setIsAdmin] = useState(false)
  const [allowRegistration, setAllowRegistration] = useState(true)
  const [timezone, setTimezoneState] = useState('Europe/Moscow')
  const [ready, setReady] = useState(false)
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

  // Fetch whether self-registration is currently allowed (admin may disable it).
  useEffect(() => {
    authApi
      .registrationStatus()
      .then((res) => setAllowRegistration(res.data?.enabled !== false))
      .catch(() => setAllowRegistration(true))
  }, [])
  // a broken dashboard.
  useEffect(() => {
    if (!token) {
      setView('login')
      setReady(true)
      return
    }
    summaryApi
      .get()
      .then(() => {
        setView('tasks')
        setReady(true)
      })
      .catch(() => {
        localStorage.removeItem('token')
        setToken(null)
        setView('login')
        setReady(true)
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

  // Load the current user's settings (e.g. timezone).
  useEffect(() => {
    if (!token) return
    authApi
      .me()
      .then((res) => {
        if (res.data?.timezone) setTimezoneState(res.data.timezone)
      })
      .catch(() => {})
  }, [token])

  const setTimezone = useCallback(async (tz) => {
    setTimezoneState(tz)
    try {
      await authApi.updateMe({ timezone: tz })
    } catch {
      // Keep the local value even if the server update fails.
    }
  }, [])

  return { token, isAdmin, view, ready, setView, login, register, logout, checkAdmin, allowRegistration, timezone, setTimezone }
}
