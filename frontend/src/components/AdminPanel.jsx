import { useState } from 'react'
import { adminApi } from '../api/client'
import Modal from './Modal'

const WEBHOOK_EVENTS = [
  ['task_created', 'Создание задачи'],
  ['task_updated', 'Изменение задачи'],
  ['task_completed', 'Выполнение задачи'],
  ['task_deleted', 'Удаление задачи'],
  ['priority_changed', 'Изменение приоритета'],
  ['deadline_approaching', 'Приближение дедлайна (<24ч)'],
  ['task_overdue', 'Просрочка задачи'],
]

const EMPTY_WEBHOOK = {
  user_id: '',
  board_id: '',
  name: '',
  url: '',
  token: '',
  chat_id: '',
  thread_id: '',
  events: [],
  excluded_events: [],
}

function EventMultiSelect({ value, onChange }) {
  const toggle = (ev) => {
    onChange(
      value.includes(ev) ? value.filter((e) => e !== ev) : [...value, ev]
    )
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 border rounded p-2 max-h-40 overflow-y-auto">
      {WEBHOOK_EVENTS.map(([ev, label]) => (
        <label key={ev} className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={value.includes(ev)}
            onChange={() => toggle(ev)}
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  )
}

export default function AdminPanel({
  users,
  onDeleteUser,
  onBack,
  settings,
  onToggleRegistration,
  onChanged,
  open,
}) {
  const [tab, setTab] = useState('users')
  const allowRegistration = settings?.allow_registration !== false
  const [isEditing, setIsEditing] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [formData, setFormData] = useState({ username: '', password: '', role: 'user' })
  const [mcpToken, setMcpToken] = useState(null)
  const [copied, setCopied] = useState(false)

  // Webhooks state
  const [webhooks, setWebhooks] = useState(null)
  const [hookEditing, setHookEditing] = useState(false)
  const [currentHook, setCurrentHook] = useState(null)
  const [hookData, setHookData] = useState(EMPTY_WEBHOOK)
  const [testingId, setTestingId] = useState(null)
  const [hookBoards, setHookBoards] = useState([])

  const loadHookBoards = (userId) => {
    if (!userId) {
      setHookBoards([])
      return
    }
    adminApi
      .userBoards(userId)
      .then((r) => setHookBoards(r.data))
      .catch(() => setHookBoards([]))
  }

  if (!open) return null

  const loadWebhooks = () => {
    adminApi.webhooks
      .list()
      .then((r) => setWebhooks(r.data))
      .catch(() => setWebhooks([]))
  }

  const openTab = (t) => {
    setTab(t)
    if (t === 'webhooks' && webhooks === null) loadWebhooks()
  }

  const handleOpenCreate = () => {
    setCurrentUser(null)
    setFormData({ username: '', password: '', role: 'user' })
    setMcpToken(null)
    setCopied(false)
    setIsEditing(true)
  }

  const handleOpenEdit = (u) => {
    setCurrentUser(u)
    setFormData({ username: u.username, password: '', role: u.role })
    setMcpToken(null)
    setCopied(false)
    setIsEditing(true)
  }

  const handleRegenerate = async () => {
    try {
      const res = await adminApi.mcpToken.regenerate(currentUser.id)
      setMcpToken(res.data.token)
      setCopied(false)
      if (onChanged) onChanged()
    } catch (e) {
      alert(e?.response?.data?.detail || 'Ошибка генерации токена')
    }
  }

  const handleRevoke = async () => {
    try {
      await adminApi.mcpToken.revoke(currentUser.id)
      setMcpToken(null)
      if (onChanged) onChanged()
    } catch (e) {
      alert(e?.response?.data?.detail || 'Ошибка отзыва токена')
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(mcpToken)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be unavailable; ignore
    }
  }

  const handleSaveUser = async (e) => {
    e.preventDefault()
    try {
      if (currentUser) {
        await adminApi.updateUser(currentUser.id, formData)
      } else {
        await adminApi.createUser(formData)
      }
      setIsEditing(false)
      onBack()
    } catch (err) {
      alert(err?.response?.data?.detail || 'Ошибка при сохранении пользователя')
    }
  }

  // --- Webhooks handlers ---

  const handleOpenHookCreate = () => {
    setCurrentHook(null)
    const uid = users[0]?.id ?? ''
    setHookData({ ...EMPTY_WEBHOOK, user_id: uid, board_id: '' })
    loadHookBoards(uid)
    setHookEditing(true)
  }

  const handleOpenHookEdit = (w) => {
    setCurrentHook(w)
    loadHookBoards(w.user_id)
    setHookData({
      user_id: w.user_id,
      board_id: w.board_id ?? '',
      name: w.name,
      url: w.url,
      token: w.token || '',
      chat_id: w.chat_id,
      thread_id: w.thread_id || '',
      events: w.events || [],
      excluded_events: w.excluded_events || [],
    })
    setHookEditing(true)
  }

  const handleSaveHook = async (e) => {
    e.preventDefault()
    try {
      if (currentHook) {
        await adminApi.webhooks.update(currentHook.id, hookData)
      } else {
        await adminApi.webhooks.create(hookData)
      }
      setHookEditing(false)
      loadWebhooks()
    } catch (err) {
      alert(err?.response?.data?.detail || 'Ошибка при сохранении веб-хука')
    }
  }

  const handleTestHook = async (w) => {
    setTestingId(w.id)
    try {
      const r = await adminApi.webhooks.test(w.id)
      if (r.data.ok) {
        alert(`Тестовое уведомление отправлено (HTTP ${r.data.status_code}).`)
      } else {
        alert(`Ошибка доставки: ${r.data.error || 'неизвестная ошибка'}`)
      }
    } catch (err) {
      alert(err?.response?.data?.detail || 'Ошибка отправки теста')
    } finally {
      setTestingId(null)
    }
  }

  const handleDeleteHook = async (id) => {
    if (!confirm('Удалить веб-хук?')) return
    try {
      await adminApi.webhooks.remove(id)
      loadWebhooks()
    } catch (err) {
      alert(err?.response?.data?.detail || 'Ошибка при удалении веб-хука')
    }
  }

  const userName = (id) => users.find((u) => u.id === id)?.username || `#${id}`

  return (
    <Modal open={open} onClose={onBack} title="Панель администратора" wide>
      <div>
        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-gray-200">
          {[
            ['users', 'Пользователи'],
            ['webhooks', 'Веб-хуки'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => openTab(key)}
              className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                tab === key
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'users' && (
          <div>
            <div className="flex justify-end mb-4">
              <button
                onClick={handleOpenCreate}
                className="bg-blue-500 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-600 transition-colors whitespace-nowrap"
              >
                + Создать пользователя
              </button>
            </div>
              <section className="bg-gray-50/50 rounded-lg p-4 mb-6 border">
                <h2 className="font-semibold mb-3 text-sm uppercase tracking-wider text-gray-500">Настройки сервера</h2>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowRegistration}
                    onChange={(e) => onToggleRegistration(e.target.checked)}
                    className="w-5 h-5"
                  />
                  <span className="text-sm">
                    Разрешить регистрацию новых пользователей
                    <span className="block text-xs text-gray-500">
                      Если выключено, новые пользователи не смогут создать аккаунт.
                    </span>
                  </span>
                </label>
              </section>

              <div className="bg-white rounded-lg border overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-gray-50">
                    <tr className="text-xs uppercase text-gray-500">
                      <th className="p-4">Пользователь</th>
                      <th className="p-2 sm:p-4 text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-gray-50">
                        <td className="p-2 sm:p-4 font-medium">{u.username}</td>
                        <td className="p-2 sm:p-4 text-right">
                          <div className="flex flex-col sm:flex-row items-end sm:items-center sm:justify-end gap-1 sm:gap-2">
                            <button
                              onClick={() => handleOpenEdit(u)}
                              className="text-blue-500 text-xs hover:underline whitespace-nowrap"
                            >
                              Изменить
                            </button>
                            <button
                              onClick={() => onDeleteUser(u.id)}
                              className="text-red-500 text-xs hover:underline whitespace-nowrap"
                            >
                              Удалить
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          </div>
        )}

        {tab === 'webhooks' && (
          <div>
            <div className="flex justify-end mb-4">
              <button
                onClick={handleOpenHookCreate}
                className="bg-blue-500 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-600 transition-colors whitespace-nowrap"
              >
                + Создать веб-хук
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Веб-хуки отправляют уведомления о событиях задач пользователя во
              внешние системы (POST JSON). Тело запроса подписывается
              HMAC-SHA256 (заголовок X-Hub-Signature-256).
            </p>
            <div className="bg-white rounded-lg border overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50">
                  <tr className="text-xs uppercase text-gray-500">
                    <th className="p-4">Название</th>
                    <th className="p-4">Пользователь</th>
                    <th className="p-4">Доска</th>
                    <th className="p-2 sm:p-4 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {(webhooks || []).map((w) => (
                    <tr key={w.id} className="hover:bg-gray-50">
                      <td className="p-2 sm:p-4 font-medium">{w.name}</td>
                      <td className="p-2 sm:p-4">{userName(w.user_id)}</td>
                      <td className="p-2 sm:p-4">{hookBoards.find((b) => b.id === w.board_id)?.name || `#${w.board_id}`}</td>
                      <td className="p-2 sm:p-4 text-right">
                        <div className="flex flex-col sm:flex-row items-end sm:items-center sm:justify-end gap-1 sm:gap-2">
                          <button
                            onClick={() => handleTestHook(w)}
                            disabled={testingId === w.id}
                            className="text-green-600 text-xs hover:underline whitespace-nowrap disabled:opacity-50"
                          >
                            {testingId === w.id ? 'Отправка…' : 'Тест'}
                          </button>
                          <button
                            onClick={() => handleOpenHookEdit(w)}
                            className="text-blue-500 text-xs hover:underline whitespace-nowrap"
                          >
                            Изменить
                          </button>
                          <button
                            onClick={() => handleDeleteHook(w.id)}
                            className="text-red-500 text-xs hover:underline whitespace-nowrap"
                          >
                            Удалить
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {webhooks !== null && webhooks.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-4 text-sm text-gray-400 text-center">
                        Веб-хуков пока нет.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isEditing && (
          <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-md p-6 relative">
              <h2 className="text-lg font-bold mb-4">
                {currentUser ? 'Редактировать пользователя' : 'Создать пользователя'}
              </h2>
              <form onSubmit={handleSaveUser} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Имя пользователя</label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full p-2 border rounded"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Пароль</label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full p-2 border rounded"
                    required={!currentUser}
                  />
                  {currentUser && <p className="text-[10px] text-gray-500 mt-1">Оставьте пустым, чтобы не менять пароль</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Роль</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full p-2 border rounded"
                  >
                    <option value="user">Пользователь</option>
                    <option value="admin">Администратор</option>
                  </select>
                </div>

                {currentUser && (
                  <div className="border-t border-gray-200 pt-4 mt-4">
                    <div className="text-sm font-medium mb-1">MCP-токен (для ИИ-агента)</div>
                    <p className="text-xs text-gray-500 mb-2">
                      Долгоживущий ключ для агента. Показывается только при генерации —
                      скопируйте его сразу в настройки агента.
                    </p>
                    {mcpToken ? (
                      <div className="flex items-center gap-2 mb-2">
                        <input
                          type="text"
                          readOnly
                          value={mcpToken}
                          className="flex-1 p-2 border rounded text-xs"
                        />
                        <button
                          type="button"
                          onClick={handleCopy}
                          className="px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600 text-sm whitespace-nowrap"
                        >
                          {copied ? 'Скопировано!' : 'Копировать'}
                        </button>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500 mb-2">
                        {currentUser.has_mcp_token ? 'Токен установлен.' : 'Токен не установлен.'}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleRegenerate}
                        className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                      >
                        {currentUser.has_mcp_token || mcpToken ? 'Сгенерировать новый' : 'Сгенерировать MCP-токен'}
                      </button>
                      {currentUser.has_mcp_token && !mcpToken && (
                        <button
                          type="button"
                          onClick={handleRevoke}
                          className="px-3 py-2 text-red-500 border border-red-500 rounded hover:bg-red-50 text-sm"
                        >
                          Отозвать
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-4 py-2 text-gray-500 hover:text-gray-700"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                  >
                    Сохранить
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {hookEditing && (
          <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-bold mb-4">
                {currentHook ? 'Редактировать веб-хук' : 'Создать веб-хук'}
              </h2>
              <form onSubmit={handleSaveHook} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Пользователь</label>
                  <select
                    value={hookData.user_id}
                    onChange={(e) => {
                      const uid = Number(e.target.value)
                      setHookData({ ...hookData, user_id: uid, board_id: '' })
                      loadHookBoards(uid)
                    }}
                    className="w-full p-2 border rounded"
                    required
                  >
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Доска</label>
                  <select
                    value={hookData.board_id}
                    onChange={(e) => setHookData({ ...hookData, board_id: Number(e.target.value) })}
                    className="w-full p-2 border rounded"
                    required
                  >
                    {hookBoards.length === 0 && <option value="">— сначала выберите пользователя —</option>}
                    {hookBoards.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-500 mt-1">
                    Уведомления приходят только о событиях задач этой доски.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Название</label>
                  <input
                    type="text"
                    value={hookData.name}
                    onChange={(e) => setHookData({ ...hookData, name: e.target.value })}
                    className="w-full p-2 border rounded"
                    placeholder="Например: уведомления в Telegram"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">URL</label>
                  <input
                    type="url"
                    value={hookData.url}
                    onChange={(e) => setHookData({ ...hookData, url: e.target.value })}
                    className="w-full p-2 border rounded"
                    placeholder="https://…"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Секрет подписи (HMAC)</label>
                  <input
                    type="text"
                    value={hookData.token}
                    onChange={(e) => setHookData({ ...hookData, token: e.target.value })}
                    className="w-full p-2 border rounded"
                    placeholder="необязательно — ключ HMAC-SHA256"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Telegram Chat ID</label>
                    <input
                      type="text"
                      value={hookData.chat_id}
                      onChange={(e) => setHookData({ ...hookData, chat_id: e.target.value })}
                      className="w-full p-2 border rounded"
                      placeholder="например: -1001234567890"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Thread ID</label>
                    <input
                      type="text"
                      value={hookData.thread_id}
                      onChange={(e) => setHookData({ ...hookData, thread_id: e.target.value })}
                      className="w-full p-2 border rounded"
                      placeholder="необязательно"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">События</label>
                  <EventMultiSelect
                    value={hookData.events}
                    onChange={(events) => setHookData({ ...hookData, events })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Исключённые события</label>
                  <EventMultiSelect
                    value={hookData.excluded_events}
                    onChange={(excluded_events) => setHookData({ ...hookData, excluded_events })}
                  />
                  <p className="text-[10px] text-gray-500 mt-1">
                    Игнорируются, даже если выбраны в общем списке.
                  </p>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    type="button"
                    onClick={() => setHookEditing(false)}
                    className="px-4 py-2 text-gray-500 hover:text-gray-700"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                  >
                    Сохранить
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
