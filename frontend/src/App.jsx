import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { useTasks } from './hooks/useTasks'
import { useTheme } from './hooks/useTheme'
import { adminApi } from './api/client'
import Login from './components/Login'
import Layout from './components/Layout'
import Dashboard from './components/Dashboard'
import TaskList from './components/TaskList'
import TaskForm from './components/TaskForm'
import AdminPanel from './components/AdminPanel'

export default function App() {
  const { token, isAdmin, view, login, register, logout, checkAdmin } = useAuth()
  const { theme, setTheme } = useTheme()
  const { tasks, summary, filterStatus, setFilterStatus, sortBy, setSortBy, create, remove } =
    useTasks()

  const [modalOpen, setModalOpen] = useState(false)
  const [adminView, setAdminView] = useState(false)
  const [users, setUsers] = useState([])
  const [authError, setAuthError] = useState('')

  const handleLogin = async (u, p) => {
    try {
      setAuthError('')
      await login(u, p)
    } catch {
      setAuthError('Login failed')
    }
  }

  const handleRegister = async (u, p) => {
    try {
      setAuthError('')
      await register(u, p)
    } catch {
      setAuthError('Registration failed')
    }
  }

  const openAdmin = async () => {
    const res = await adminApi.listUsers()
    setUsers(res.data)
    setAdminView(true)
  }

  const changeRole = async (id, role) => {
    await adminApi.updateRole(id, role)
    openAdmin()
  }

  const delUser = async (id) => {
    await adminApi.deleteUser(id)
    openAdmin()
  }

  if (!token || view === 'login') {
    return <Login onLogin={handleLogin} onRegister={handleRegister} error={authError} />
  }

  if (adminView) {
    return (
      <AdminPanel
        users={users}
        onUpdateRole={changeRole}
        onDeleteUser={delUser}
        onBack={() => setAdminView(false)}
      />
    )
  }

  return (
    <Layout
      isAdmin={isAdmin}
      onAdmin={openAdmin}
      onLogout={logout}
      theme={theme}
      onThemeChange={setTheme}
    >
      <Dashboard summary={summary} />

      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">My Tasks</h3>
        <button
          onClick={() => setModalOpen(true)}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 flex items-center gap-2"
        >
          <span>+</span> New Task
        </button>
      </div>

      <TaskList
        tasks={tasks}
        onDelete={remove}
        filterStatus={filterStatus}
        setFilterStatus={setFilterStatus}
        sortBy={sortBy}
        setSortBy={setSortBy}
      />

      <TaskForm open={modalOpen} onClose={() => setModalOpen(false)} onCreate={create} />
    </Layout>
  )
}
