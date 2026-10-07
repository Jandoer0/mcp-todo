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
  const { token, isAdmin, view, login, register, logout, checkAdmin, allowRegistration } =
    useAuth()
  const { theme, setTheme } = useTheme()
  const { tasks, summary, filterStatus, setFilterStatus, sortBy, setSortBy, create, update, remove } =
    useTasks()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [adminView, setAdminView] = useState(false)
  const [users, setUsers] = useState([])
  const [settings, setSettings] = useState({ allow_registration: true })
  const [authError, setAuthError] = useState('')

  const handleLogin = async (u, p) => {
    try {
      setAuthError('')
      await login(u, p)
    } catch (err) {
      setAuthError(err?.response?.data?.detail || 'Неверный логин или пароль')
    }
  }

  const handleRegister = async (u, p) => {
    try {
      setAuthError('')
      await register(u, p)
    } catch (err) {
      setAuthError(err?.response?.data?.detail || 'Ошибка регистрации')
    }
  }

  const openAdmin = async () => {
    const [usersRes, settingsRes] = await Promise.all([
      adminApi.listUsers(),
      adminApi.getSettings(),
    ])
    setUsers(usersRes.data)
    setSettings(settingsRes.data)
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

  const toggleRegistration = async (enabled) => {
    await adminApi.setRegistration(enabled)
    const res = await adminApi.getSettings()
    setSettings(res.data)
  }

  const openNew = () => {
    setEditingTask(null)
    setModalOpen(true)
  }

  const openEdit = (task) => {
    setEditingTask(task)
    setModalOpen(true)
  }

  const handleSubmit = async (payload) => {
    if (editingTask) {
      await update(editingTask.id, payload)
    } else {
      await create(payload)
    }
  }

  const setStatus = async (task, status) => {
    try {
      await update(task.id, { status })
    } catch (err) {
      if (err?.response?.status === 400) {
        alert(err?.response?.data?.detail || 'Действие невозможно')
      }
    }
  }

  if (!token || view === 'login') {
    return (
      <Login
        onLogin={handleLogin}
        onRegister={handleRegister}
        error={authError}
        allowRegistration={allowRegistration}
      />
    )
  }

  if (adminView) {
    return (
      <AdminPanel
        users={users}
        settings={settings}
        onUpdateRole={changeRole}
        onDeleteUser={delUser}
        onToggleRegistration={toggleRegistration}
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
        <h3 className="text-lg font-semibold">Мои задачи</h3>
        <button
          onClick={openNew}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 flex items-center gap-2"
        >
          <span>+</span> Новая задача
        </button>
      </div>

      <TaskList
        tasks={tasks}
        onDelete={remove}
        onEdit={openEdit}
        onSetStatus={setStatus}
        filterStatus={filterStatus}
        setFilterStatus={setFilterStatus}
        sortBy={sortBy}
        setSortBy={setSortBy}
      />

      <TaskForm
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        task={editingTask}
        tasks={tasks}
      />
    </Layout>
  )
}
