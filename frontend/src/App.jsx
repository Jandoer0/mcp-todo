import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { useTasks } from './hooks/useTasks'
import { useTheme } from './hooks/useTheme'
import { adminApi } from './api/client'
import Login from './components/Login'
import Layout from './components/Layout'
import Dashboard from './components/Dashboard'
import Board from './components/Board'
import TaskForm from './components/TaskForm'
import ListsManager from './components/ListsManager'
import AdminPanel from './components/AdminPanel'

export default function App() {
  const { token, isAdmin, view, ready, login, register, logout, checkAdmin, allowRegistration } =
    useAuth()
  const { theme, setTheme } = useTheme()
  const {
    tasks,
    summary,
    lists,
    tags,
    activeFilter,
    setActiveFilter,
    activeTag,
    setActiveTag,
    create,
    update,
    remove,
    setList,
    load,
  } = useTasks(ready)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [adminView, setAdminView] = useState(false)
  const [users, setUsers] = useState([])
  const [settings, setSettings] = useState({ allow_registration: true })
  const [authError, setAuthError] = useState('')
  const [listsOpen, setListsOpen] = useState(false)

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
    await adminApi.updateUser(id, { role })
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
    try {
      if (payload._action === 'delete') {
        if (editingTask) {
          await remove(editingTask.id)
          setModalOpen(false)
        }
        return
      }

      if (editingTask) {
        await update(editingTask.id, payload)
      } else {
        await create(payload)
      }
      setModalOpen(false)
    } catch (err) {
      alert(err?.response?.data?.detail || 'Произошла ошибка при сохранении задачи')
    }
  }

  const handleSetList = async (task, listName) => {
    try {
      await setList(task.id, listName)
    } catch (err) {
      if (err?.response?.status === 400) {
        alert(err?.response?.data?.detail || 'Действие невозможно')
      }
    }
  }

  const handleDelete = async (task) => {
    try {
      await remove(task.id)
    } catch (err) {
      alert(err?.response?.data?.detail || 'Не удалось удалить задачу')
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

  // adminView state is now used to control the AdminPanel modal rendered below
  

  return (
    <Layout
      isAdmin={isAdmin}
      onAdmin={openAdmin}
      onLogout={logout}
      theme={theme}
      onThemeChange={setTheme}
    >
      <Dashboard 
        summary={summary} 
        activeFilter={activeFilter} 
        onFilterChange={setActiveFilter} 
      />

      <div className="flex justify-between items-center mb-4 gap-4">
        {/* Tag Cloud Filter */}
        <button
          onClick={() => setListsOpen(true)}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 whitespace-nowrap"
        >
          Списки
        </button>

        <div className="hidden md:flex flex-wrap gap-2 items-center justify-center flex-1">
          {tags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => setActiveTag(activeTag === tag.id ? null : tag.id)}
              className={`px-2 py-1 rounded-full text-xs transition-all border ${
                activeTag === tag.id
                  ? 'ring-2 ring-offset-1 ring-blue-400 bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-100 border-blue-400'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-transparent hover:border-gray-300'
              }`}
              style={{
                backgroundColor: activeTag === tag.id ? undefined : tag.color + '20',
                color: activeTag === tag.id ? undefined : tag.color,
              }}
            >
              {tag.name}
            </button>
          ))}
          {activeTag && (
            <button
              onClick={() => setActiveTag(null)}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              ✕ Очистить
            </button>
          )}
        </div>

        <button
          onClick={openNew}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 flex items-center gap-2 whitespace-nowrap"
        >
          <span>+</span> Новая задача
        </button>
      </div>

      <Board
        tasks={tasks}
        lists={lists}
        tags={tags}
        activeFilter={activeFilter}
        activeTag={activeTag}
        onSetList={handleSetList}
        onEdit={openEdit}
        onDelete={handleDelete}
      />

      <TaskForm
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        task={editingTask}
        tasks={tasks}
        lists={lists}
        tags={tags}
      />

      <ListsManager
        open={listsOpen}
        onClose={() => setListsOpen(false)}
        lists={lists}
        onChanged={() => load()}
      />

      <AdminPanel
        open={adminView}
        users={users}
        settings={settings}
        onUpdateRole={changeRole}
        onDeleteUser={delUser}
        onToggleRegistration={toggleRegistration}
        onChanged={openAdmin}
        onBack={() => setAdminView(false)}
      />
    </Layout>
  )
}
