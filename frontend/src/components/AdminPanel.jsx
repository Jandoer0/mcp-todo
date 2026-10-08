import { useState } from 'react'
import { adminApi } from '../api/client'

export default function AdminPanel({
  users,
  onUpdateRole,
  onDeleteUser,
  onBack,
  settings,
  onToggleRegistration,
  onChanged,
  open,
}) {
  if (!open) return null

  const allowRegistration = settings?.allow_registration !== false
  const [isEditing, setIsEditing] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [formData, setFormData] = useState({ username: '', password: '', role: 'user' })
  const [mcpToken, setMcpToken] = useState(null)
  const [copied, setCopied] = useState(false)

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
      // We need to refresh the users list in App.jsx. 
      // Since we don't have a direct refresh function passed, 
      // the easiest way is to trigger onBack and then reopen or rely on the parent's update.
      // But better: we call onBack to close and let parent handle it? 
      // No, the parent needs to reload. Let's assume onBack also refreshes.
      onBack()
    } catch (err) {
      alert(err?.response?.data?.detail || 'Ошибка при сохранении пользователя')
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col relative">
        <header className="bg-gray-50 dark:bg-gray-700 p-4 border-b dark:border-gray-600 flex justify-between items-center">
          <h1 className="text-xl font-bold">Панель администратора</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={handleOpenCreate}
              className="bg-blue-500 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-600 transition-colors"
            >
              + Создать пользователя
            </button>
            <button
              onClick={onBack}
              aria-label="Закрыть"
              className="w-8 h-8 flex items-center justify-center rounded text-gray-500 hover:text-gray-700 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-600 text-xl leading-none"
            >
              ✕
            </button>
          </div>
        </header>

        <main className="p-6 overflow-y-auto">
          <section className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 mb-6 border dark:border-gray-600">
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

          <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr className="text-xs uppercase text-gray-500">
                  <th className="p-4">Пользователь</th>
                  <th className="p-4">Роль</th>
                  <th className="p-4 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="p-4 font-medium">{u.username}</td>
                    <td className="p-4">
                      <select
                        value={u.role}
                        onChange={(e) => onUpdateRole(u.id, e.target.value)}
                        className="bg-gray-100 dark:bg-gray-600 border-none rounded text-xs p-1 outline-none"
                      >
                        <option value="user">Пользователь</option>
                        <option value="admin">Администратор</option>
                      </select>
                    </td>
                    <td className="p-4 text-right flex justify-end gap-2">
                      <button
                        onClick={() => handleOpenEdit(u)}
                        className="text-blue-500 text-xs hover:underline"
                      >
                        Изменить
                      </button>
                      <button
                        onClick={() => onDeleteUser(u.id)}
                        className="text-red-500 text-xs hover:underline"
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>

        {isEditing && (
          <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-md p-6 relative">
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
                    className="w-full p-2 border rounded dark:bg-gray-700"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Пароль</label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full p-2 border rounded dark:bg-gray-700"
                    required={!currentUser}
                  />
                  {currentUser && <p className="text-[10px] text-gray-500 mt-1">Оставьте пустым, чтобы не менять пароль</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Роль</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full p-2 border rounded dark:bg-gray-700"
                  >
                    <option value="user">Пользователь</option>
                    <option value="admin">Администратор</option>
                  </select>
                </div>

                {currentUser && (
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
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
                          className="flex-1 p-2 border rounded dark:bg-gray-700 text-xs font-mono"
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
                          className="px-3 py-2 text-red-500 border border-red-500 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-sm"
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
                    className="px-4 py-2 text-gray-500 hover:text-gray-700 dark:text-gray-400"
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
    </div>
  )
}
