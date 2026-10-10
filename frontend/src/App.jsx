import { useState, useEffect } from 'react'
import { useAuth } from './hooks/useAuth'
import { useTasks } from './hooks/useTasks'
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
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)

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
  

  const FILTERS = summary
    ? [
        { id: 'all', label: 'Всего задач', count: summary.total },
        { id: 'todo', label: 'К выполнению', count: summary.todo },
        { id: 'in_progress', label: 'В работе', count: summary.in_progress },
        { id: 'done', label: 'Выполнено', count: summary.done },
        { id: 'overdue', label: 'Просрочено', count: summary.overdue },
        { id: 'planned', label: 'Запланировано', count: summary.planned ?? 0 },
      ]
    : []

  const tagCloud = (
    <>
      {tags.map((tag) => (
        <button
          key={tag.id}
          onClick={() => setActiveTag(activeTag === tag.id ? null : tag.id)}
          className={`px-2 py-0.5 rounded text-xs font-semibold text-white transition-all ${
            activeTag === tag.id
              ? 'ring-2 ring-white/70 scale-105'
              : 'opacity-90 hover:opacity-100'
          }`}
          style={{ backgroundColor: tag.color }}
        >
          {tag.name}
        </button>
      ))}
      {activeTag && (
        <button
          onClick={() => setActiveTag(null)}
          className="text-xs text-white/60 hover:text-white"
        >
          ✕ Очистить
        </button>
      )}
    </>
  )

  return (
    <Layout
      isAdmin={isAdmin}
      onAdmin={openAdmin}
      onLogout={logout}
    >
      <Dashboard 
        summary={summary} 
        activeFilter={activeFilter} 
        onFilterChange={setActiveFilter} 
      />

      {/* Tag Cloud — mobile: between header and buttons row */}
      <div className="md:hidden flex flex-wrap gap-2 items-center mb-3">
        {tagCloud}
      </div>

      <div className="flex justify-between items-center mb-4 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setListsOpen(true)}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 whitespace-nowrap"
          >
            Списки
          </button>

          {/* Mobile: filters as a dropdown between the two buttons */}
          <div className="md:hidden relative">
            <button
              onClick={() => setFilterMenuOpen((v) => !v)}
              className="bg-white text-slate-700 px-3 py-2 rounded shadow-sm text-sm flex items-center gap-1 whitespace-nowrap"
            >
              {FILTERS.find((f) => f.id === activeFilter)?.label || 'Фильтры'}
              <span className={`text-[10px] transition-transform ${filterMenuOpen ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {filterMenuOpen && (
              <div className="absolute left-0 top-full mt-1 z-40 bg-white rounded shadow-lg py-1 min-w-[12rem]">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      setActiveFilter(f.id)
                      setFilterMenuOpen(false)
                    }}
                    className={`w-full text-left px-3 py-2 text-sm flex justify-between items-center hover:bg-slate-100 ${
                      activeFilter === f.id ? 'font-semibold text-blue-600' : 'text-slate-700'
                    }`}
                  >
                    <span>{f.label}</span>
                    <span className="text-xs text-slate-400">{f.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tag Cloud Filter — desktop: inside the buttons row */}
        <div className="hidden md:flex flex-wrap gap-2 items-center justify-center flex-1">
          {tagCloud}
        </div>

        <button
          onClick={openNew}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 flex items-center gap-2 whitespace-nowrap"
        >
          <span>+</span> <span className="hidden md:inline">Новая задача</span><span className="md:hidden">Новая</span>
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
        onRefresh={load}
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
