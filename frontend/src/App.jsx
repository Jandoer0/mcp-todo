import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from './hooks/useAuth'
import { useSettings } from './i18n/settings.jsx'
import { useTasks } from './hooks/useTasks'
import { adminApi, authApi, boardsApi, currenciesApi, tagsApi, tasksApi } from './api/client'
import Login from './components/Login'
import Layout from './components/Layout'
import Dashboard from './components/Dashboard'
import Board from './components/Board'
import TaskForm from './components/TaskForm'
import CyclicTaskForm from './components/CyclicTaskForm'
import ListsManager from './components/ListsManager'
import BoardForm from './components/BoardForm'
import AdminPanel from './components/AdminPanel'
import CurrencyManager from './components/CurrencyManager'
import Planner from './components/Planner'
import { PALETTE } from './constants'

export default function App() {
  const { t } = useTranslation()
  const prefs = useSettings()
  const { token, isAdmin, view, ready, login, register, logout, checkAdmin, allowRegistration, passwordMin } =
    useAuth()

  // --- Boards (multi-board support) ---
  const [boards, setBoards] = useState([])
  const [activeBoardId, setActiveBoardId] = useState(null)
  const [boardFormOpen, setBoardFormOpen] = useState(false)
  const [editingBoard, setEditingBoard] = useState(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profile, setProfile] = useState(null)
  const [webhooksEnabled, setWebhooksEnabled] = useState(true)
  // «Параметры валют»: список валют пользователя + открытие окна управления
  const [currencies, setCurrencies] = useState([])
  const [currenciesOpen, setCurrenciesOpen] = useState(false)
  const [cyclicFormOpen, setCyclicFormOpen] = useState(false)
  const [editingCyclicTask, setEditingCyclicTask] = useState(null)
  const [plannerOpen, setPlannerOpen] = useState(false)

  const loadCurrencies = () =>
    currenciesApi
      .list()
      .then((res) => setCurrencies(res.data || []))
      .catch(() => {})

  useEffect(() => {
    if (ready) loadCurrencies()
  }, [ready, token])

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
    reorder,
    load,
    mutationTick,
    markMutated,
  } = useTasks(ready, activeBoardId)

  const loadBoards = async () => {
    const res = await boardsApi.list()
    setBoards(res.data)
    setActiveBoardId((prev) => {
      if (prev && res.data.some((b) => b.id === prev)) return prev
      const stored = Number(localStorage.getItem('activeBoard'))
      if (stored && res.data.some((b) => b.id === stored)) return stored
      return res.data[0]?.id ?? null
    })
  }

  useEffect(() => {
    if (ready) loadBoards().catch(() => {})
  }, [ready])

  // Whether the user may configure webhooks (admin can revoke the right);
  // controls the board editor's «Веб-хуки» tab.
  useEffect(() => {
    if (!ready) return
    authApi
      .me()
      .then((res) => {
        setWebhooksEnabled(res.data?.webhooks_enabled !== false)
        // /me also carries UI policy values (board cap, password hint).
        setProfile(res.data)
        // Язык и региональные настройки едины на всех устройствах: профиль
        // с сервера перезаписывает локальный выбор (см. i18n/settings.jsx).
        prefs.applyProfile(res.data)
      })
      .catch(() => setWebhooksEnabled(true))
  }, [ready, token])

  useEffect(() => {
    if (activeBoardId) localStorage.setItem('activeBoard', String(activeBoardId))
  }, [activeBoardId])

  const activeBoard = boards.find((b) => b.id === activeBoardId) || null

  const handleSwitchBoard = (id) => {
    setActiveBoardId(id)
    setActiveFilter('all')
    setActiveTag(null)
  }

  // Перестановка досок перетаскиванием: сохраняем порядок, полученный из ленты
  const handleBoardReorder = async (fromId, orderedIds) => {
    const updated = orderedIds
      .map((id, idx) => ({ id, position: idx }))
      .filter((u) => {
        const b = boards.find((p) => p.id === u.id)
        return b && b.position !== u.position
      })
    if (!updated.length) return
    // оптимистичное обновление ленты
    setBoards((prev) =>
      prev.map((b) => {
        const u = orderedIds.indexOf(b.id)
        return u === -1 ? b : { ...b, position: u }
      }),
    )
    try {
      await Promise.all(updated.map((u) => boardsApi.update(u.id, { position: u.position })))
    } catch {
      alert(t('errors.reorderFailed'))
    }
    await loadBoards()
  }

  const handleBoardSubmit = async (data) => {
    if (editingBoard) {
      await boardsApi.update(editingBoard.id, data)
      setBoardFormOpen(false)
      setEditingBoard(null)
      await loadBoards()
    } else {
      const res = await boardsApi.create(data)
      setBoardFormOpen(false)
      await loadBoards()
      setActiveBoardId(res.data.id)
    }
  }

  const handleBoardDelete = async (board) => {
    await boardsApi.remove(board.id)
    setBoardFormOpen(false)
    setEditingBoard(null)
    // сбрасываем сохранённый выбор: loadBoards выберет первую оставшуюся доску
    localStorage.removeItem('activeBoard')
    await loadBoards()
  }

  const openProfile = async () => {
    try {
      const res = await authApi.me()
      setProfile(res.data)
      // Профиль — источник истины после входа: применяем язык и региональные
      // настройки с сервера, чтобы они совпадали на любом устройстве.
      prefs.applyProfile(res.data)
    } catch {
      setProfile(null)
    }
    setProfileOpen(true)
  }

  const [modalOpen, setModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [adminView, setAdminView] = useState(false)
  const [users, setUsers] = useState([])
  const [settings, setSettings] = useState({ allow_registration: true })
  const [authError, setAuthError] = useState('')
  const [listsOpen, setListsOpen] = useState(false)
  // Пресет колонки для кнопки «+» в шапке колонки (ТЗv2 §1.2).
  const [presetList, setPresetList] = useState(null)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [filterMenuClosing, setFilterMenuClosing] = useState(false)
  const filterMenuTimer = useRef(null)

  // Animated close for the mobile filters dropdown.
  const closeFilterMenu = () => {
    if (!filterMenuOpen || filterMenuClosing) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFilterMenuOpen(false)
      return
    }
    setFilterMenuClosing(true)
    filterMenuTimer.current = setTimeout(() => {
      setFilterMenuClosing(false)
      setFilterMenuOpen(false)
    }, 140)
  }

  const handleLogin = async (u, p) => {
    try {
      setAuthError('')
      await login(u, p)
    } catch (err) {
      setAuthError(err?.response?.data?.detail || t('errors.loginFailed'))
    }
  }

  const handleRegister = async (u, p) => {
    try {
      setAuthError('')
      await register(u, p)
    } catch (err) {
      setAuthError(err?.response?.data?.detail || t('errors.registerFailed'))
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
    setPresetList(null)
    setModalOpen(true)
  }

  const openEdit = (task) => {
    if (task.is_cyclic) {
      setEditingCyclicTask(task)
      setCyclicFormOpen(true)
      return
    }
    setEditingTask(task)
    setModalOpen(true)
  }

  const openCyclic = (task = null) => {
    setEditingCyclicTask(task)
    setCyclicFormOpen(true)
  }

  const handleCyclicSubmit = async (payload) => {
    try {
      if (editingCyclicTask) await update(editingCyclicTask.id, payload)
      else await create(payload)
      setCyclicFormOpen(false)
      setEditingCyclicTask(null)
    } catch (err) {
      alert(err?.response?.data?.detail || t('errors.saveCyclicFailed'))
    }
  }

  const handleCyclicDelete = async (task) => {
    if (!confirm(t('errors.deleteCyclicConfirm', { title: task.title }))) return
    try {
      await remove(task.id)
      setCyclicFormOpen(false)
      setEditingCyclicTask(null)
    } catch (err) {
      alert(err?.response?.data?.detail || t('errors.deleteCyclicFailed'))
    }
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
      alert(err?.response?.data?.detail || t('errors.saveTaskFailed'))
    }
  }

  const handleMoveTask = async (task, targetBoardId) => {
    try {
      await tasksApi.move(task.id, targetBoardId)
      await load()
      markMutated()
      // если задача ушла с активной доски — она исчезнет из текущего списка
    } catch (err) {
      alert(err?.response?.data?.detail || t('errors.transferFailed'))
    }
  }

  const handleSetList = async (task, listName, extra = {}) => {
    try {
      await setList(task.id, listName, extra)
    } catch (err) {
      if (err?.response?.status === 400) {
        alert(err?.response?.data?.detail || t('errors.actionFailed'))
      }
    }
  }

  // Канбан DnD (ТЗv2 §1.4): перенос карточки — один запрос (колонка+позиция).
  const handleReorder = async (task, listName, position) => {
    try {
      await reorder(task.id, listName, position)
    } catch (err) {
      alert(err?.response?.data?.detail || t('errors.moveTaskFailed'))
    }
  }

  const handleDelete = async (task) => {
    try {
      await remove(task.id)
    } catch (err) {
      alert(err?.response?.data?.detail || t('errors.deleteTaskFailed'))
    }
  }

  // adminView state is now used to control the AdminPanel modal rendered below
  

  const FILTERS = summary
    ? [
        { id: 'all', label: t('filters.all'), count: summary.total },
        { id: 'todo', label: t('filters.todo'), count: summary.todo },
        { id: 'in_progress', label: t('filters.in_progress'), count: summary.in_progress },
        { id: 'done', label: t('filters.done'), count: summary.done },
        { id: 'overdue', label: t('filters.overdue'), count: summary.overdue },
        { id: 'planned', label: t('filters.planned'), count: summary.planned ?? 0 },
      ]
    : []

  const randomizeTagColor = async (tag) => {
    const choices = PALETTE.filter((color) => color.toLowerCase() !== String(tag.color || '').toLowerCase())
    const color = choices[Math.floor(Math.random() * choices.length)] || PALETTE[0]
    try {
      await tagsApi.update(activeBoardId, tag.id, { color })
      await load()
    } catch (err) {
      alert(err?.response?.data?.detail || t('errors.changeTagColorFailed'))
    }
  }

  const tagCloud = (
    <>
      {tags.map((tag) => (
        <button
          key={tag.id}
          onClick={() => setActiveTag(activeTag === tag.id ? null : tag.id)}
          onDoubleClick={(e) => {
            e.preventDefault()
            randomizeTagColor(tag)
          }}
          title="Клик — фильтр · двойной клик — случайный цвет"
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

  if (!token || view === 'login') {
    return (
      <Login
        onLogin={handleLogin}
        onRegister={handleRegister}
        error={authError}
        allowRegistration={allowRegistration}
        passwordMin={passwordMin}
      />
    )
  }

  return (
    <>
      <Planner
        open={plannerOpen}
        onClose={() => setPlannerOpen(false)}
        reloadToken={mutationTick}
        onEdit={(task) => {
          // Планировщик остаётся под модальным окном: доска не переключается,
          // пользователь возвращается к той же дате после закрытия редактора.
          openEdit(task)
        }}
      />
      <Layout
      isAdmin={isAdmin}
      onAdmin={openAdmin}
      onLogout={logout}
      onProfile={openProfile}
      onCurrencies={() => {
        loadCurrencies()
        setCurrenciesOpen(true)
      }}
      boards={boards}
      activeBoardId={activeBoardId}
      activeBoard={activeBoard}
      onSwitchBoard={handleSwitchBoard}
      onReorderBoard={handleBoardReorder}
      onEditBoard={() => {
        setEditingBoard(activeBoard)
        setBoardFormOpen(true)
      }}
      onCreateBoard={() => {
        setEditingBoard(null)
        setBoardFormOpen(true)
      }}
      onPlanner={() => setPlannerOpen(true)}
      maxBoards={profile?.max_boards}
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

      <div className="flex justify-between items-center mb-4 gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {/* Mobile: кнопка Планировщика (на десктопе он остаётся в шапке) */}
          <button
            type="button"
            onClick={() => setPlannerOpen(true)}
            title={t('planner.title')}
            className="md:hidden shrink-0 rounded-lg bg-green-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-green-700"
          >
            {t('planner.title')}
          </button>

          {/* Mobile: фильтры — дропдауном, справа от Планировщика */}
          <div className="md:hidden relative">
            <button
              onClick={() => (filterMenuOpen ? closeFilterMenu() : (clearTimeout(filterMenuTimer.current), setFilterMenuClosing(false), setFilterMenuOpen(true)))}
              className="bg-card text-slate-700 px-3 py-2 rounded shadow-sm text-sm flex items-center gap-1 whitespace-nowrap"
            >
              {FILTERS.find((f) => f.id === activeFilter)?.label || 'Фильтры'}
              <span className={`text-[10px] transition-transform ${filterMenuOpen ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {/* Full-screen invisible overlay: closes the menu on any tap
                outside of it and blocks the dashboard underneath. */}
            {(filterMenuOpen || filterMenuClosing) && (
              <div
                className="fixed inset-0 z-30"
                onClick={closeFilterMenu}
              />
            )}
            {(filterMenuOpen || filterMenuClosing) && (
              <div className={`absolute left-0 top-full mt-1 z-40 bg-white rounded shadow-lg py-1 min-w-[12rem] ${filterMenuClosing ? 'dropdown-out' : 'dropdown-in'}`}>
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      setActiveFilter(f.id)
                      closeFilterMenu()
                    }}
                    className={`w-full text-left px-3 py-2 text-sm flex justify-between items-center hover:bg-slate-100 ${
                      activeFilter === f.id ? 'font-semibold text-[#22384d] bg-slate-100' : 'text-slate-700'
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
      </div>

      <Board
        tasks={tasks}
        lists={lists}
        tags={tags}
        activeFilter={activeFilter}
        activeTag={activeTag}
        boardId={activeBoardId}
        onSetList={handleSetList}
        onReorder={handleReorder}
        onEdit={openEdit}
        onDelete={handleDelete}
        onRefresh={async () => {
          await load()
          // Циклические операции (skip/stop/complete/корректировка истории)
          // мутируют задачи — толкаем токен для Планировщика.
          markMutated()
        }}
        onAddTask={(listName) => {
          setEditingTask(null)
          setPresetList(listName)
          setModalOpen(true)
        }}
        currencies={currencies}
        onManageLists={() => setListsOpen(true)}
        onEditCyclic={openCyclic}
      />

      <CyclicTaskForm
        open={cyclicFormOpen}
        task={editingCyclicTask}
        lists={lists}
        tags={tags}
        onClose={() => {
          setCyclicFormOpen(false)
          setEditingCyclicTask(null)
        }}
        onSubmit={handleCyclicSubmit}
        onDelete={handleCyclicDelete}
      />

      <TaskForm
        open={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setPresetList(null)
        }}
        onSubmit={handleSubmit}
        task={editingTask}
        tasks={tasks}
        boards={boards}
        defaultBoardId={activeBoardId}
        onMove={handleMoveTask}
        lists={lists}
        tags={tags}
        initialList={presetList}
        onQuickUpdate={async (id, data) => {
          await update(id, data)
        }}
        initialTags={activeTag != null ? tags.filter((t) => t.id === activeTag).map((t) => t.name) : []}
      />

      <ListsManager
        open={listsOpen}
        onClose={() => setListsOpen(false)}
        boardId={activeBoardId}
        lists={lists}
        onChanged={() => load()}
      />

      <BoardForm
        open={boardFormOpen}
        board={editingBoard}
        boardsCount={boards.length}
        maxBoards={profile?.max_boards}
        tasks={tasks}
        lists={lists}
        webhooksEnabled={webhooksEnabled}
        onImported={load}
        onChanged={load}
        onClose={() => {
          setBoardFormOpen(false)
          setEditingBoard(null)
        }}
        onSubmit={handleBoardSubmit}
        onDelete={handleBoardDelete}
      />

      {profileOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center p-4"
          onClick={() => setProfileOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-2xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold mb-4">{t('profile.title')}</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">{t('profile.username')}</span>
                <span className="font-medium">{profile?.username ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{t('profile.userId')}</span>
                <span className="font-medium">{profile?.id ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{t('profile.role')}</span>
                <span className="font-medium">
                  {profile?.role === 'admin' ? t('profile.roleAdmin') : t('profile.roleUser')}
                </span>
              </div>
              {activeBoard && (
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('profile.currentBoard')}</span>
                  <span className="font-medium">{activeBoard.name}</span>
                </div>
              )}
            </div>

            {/* Локализация и региональные настройки (ТЗ «Многоязычность» §3):
                применяются сразу, сохраняются в профиле на сервере. */}
            <div className="mt-5 border-t border-slate-200 pt-4 space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t('profile.settings')}
              </div>
              <label className="block text-sm">
                <span className="text-gray-500">{t('profile.language')}</span>
                <select
                  value={prefs.language}
                  onChange={(e) => prefs.setLanguage(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-slate-800"
                >
                  <option value="ru">{t('languages.ru')}</option>
                  <option value="en">{t('languages.en')}</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-gray-500">{t('profile.dateFormat')}</span>
                <select
                  value={prefs.dateFormat}
                  onChange={(e) => prefs.setDateFormat(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-slate-800"
                >
                  {['eu', 'us', 'iso', 'friendly'].map((key) => (
                    <option key={key} value={key}>{t(`dateFormats.${key}`)}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-gray-500">{t('profile.firstDayOfWeek')}</span>
                <select
                  value={prefs.firstDayOfWeek}
                  onChange={(e) => prefs.setFirstDayOfWeek(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-slate-800"
                >
                  <option value="monday">{t('weekStarts.monday')}</option>
                  <option value="sunday">{t('weekStarts.sunday')}</option>
                </select>
              </label>
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={() => setProfileOpen(false)}
                className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded"
              >
                {t('profile.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {currenciesOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center p-4"
          onClick={() => setCurrenciesOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-2xl w-full max-w-lg p-6 max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold mb-4">Параметры валют</h2>
            <CurrencyManager currencies={currencies} onChanged={loadCurrencies} />
            <div className="flex justify-end mt-6">
              <button
                onClick={() => setCurrenciesOpen(false)}
                className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

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
    </>
  )
}
