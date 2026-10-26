import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { adminApi } from '../api/client'
import { formatApiError } from '../api/errors'
import Modal from './Modal'

// Edit dialog state: one form for both create and edit.
const EMPTY_FORM = { username: '', password: '', role: 'user', webhooks_enabled: true }

// Форматтеры получают t — юниты лежат в словаре (admin.units.*).
function formatBytes(b, t) {
  if (!b) return `0 ${t('admin.units.b')}`
  if (b < 1024) return `${b} ${t('admin.units.b')}`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} ${t('admin.units.kb')}`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} ${t('admin.units.mb')}`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} ${t('admin.units.gb')}`
}

function formatUptime(sec, t) {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d} ${t('admin.units.d')} ${h} ${t('admin.units.h')}`
  if (h > 0) return `${h} ${t('admin.units.h')} ${m} ${t('admin.units.min')}`
  return `${m} ${t('admin.units.min')}`
}

// Admin-panel tunables (PUT /admin/settings), grouped for the Server tab.
// Подписи полей и групп — в словаре (admin.settings.* / admin.groups.*).
const TUNABLE_GROUPS = [
  {
    key: 'security',
    fields: [
      { key: 'session_expire_minutes', min: 60, max: 43200 },
      { key: 'login_rate_limit', bool: true },
      { key: 'login_max_attempts', min: 1, max: 1000 },
      { key: 'login_window_sec', min: 30, max: 86400 },
      { key: 'register_rate_limit_per_hour', min: 0, max: 10000 },
      { key: 'password_min_length', min: 4, max: 128 },
      { key: 'max_body_mb', min: 1, max: 100 },
      { key: 'maintenance_mode', bool: true, danger: true },
    ],
  },
  {
    key: 'notifications',
    fields: [
      { key: 'scheduler_interval_min', min: 1, max: 1440 },
      { key: 'deadline_window_hours', min: 1, max: 720 },
      { key: 'overdue_repeat_hours', min: 0, max: 720 },
      { key: 'webhook_timeout_sec', min: 1, max: 120 },
    ],
  },
  {
    key: 'limits',
    fields: [
      { key: 'max_boards_per_user', min: 1, max: 1000 },
      { key: 'max_description_length', min: 1000, max: 1000000 },
    ],
  },
]

export default function AdminPanel({
  users,
  onDeleteUser,
  onBack,
  settings,
  onToggleRegistration,
  onChanged,
  open,
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('users')
  const allowRegistration = settings?.allow_registration !== false
  const [isEditing, setIsEditing] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [mcpToken, setMcpToken] = useState(null)
  const [copied, setCopied] = useState(false)

  // Webhooks state: read-only overview of every webhook on the server
  // (configuration lives in the board editor, one webhook per board).
  const [webhooks, setWebhooks] = useState(null)

  // Server stats state
  const [stats, setStats] = useState(null)
  const [dbLimit, setDbLimit] = useState('')
  const [savingLimit, setSavingLimit] = useState(false)
  // Admin-panel tunables (session length, rate limits, scheduler, caps).
  const [tunable, setTunable] = useState(null)
  const [savingGroup, setSavingGroup] = useState(null)
  const [savedGroup, setSavedGroup] = useState(null)

  if (!open) return null

  const loadWebhooks = () => {
    adminApi.webhooks
      .list()
      .then((r) => setWebhooks(r.data))
      .catch(() => setWebhooks([]))
  }

  const openTab = (key) => {
    setTab(key)
    if (key === 'webhooks' && webhooks === null) loadWebhooks()
    if (key === 'server' && stats === null) {
      loadStats()
      loadTunables()
    }
  }

  const loadTunables = () => {
    adminApi
      .getSettings()
      .then((r) => setTunable(r.data))
      .catch(() => setTunable(null))
  }

  // Save one group (security / notifications / limits); only number fields
  // present and parseable are sent, booleans go as-is.
  const handleSaveGroup = async (group) => {
    if (!tunable) return
    const payload = {}
    for (const f of group.fields) {
      if (f.bool) {
        payload[f.key] = Boolean(tunable[f.key])
      } else {
        const n = parseInt(tunable[f.key], 10)
        if (!Number.isNaN(n)) payload[f.key] = n
      }
    }
    setSavingGroup(group.key)
    try {
      const res = await adminApi.updateSettings(payload)
      setTunable(res.data)
      setSavedGroup(group.key)
      setTimeout(() => setSavedGroup(null), 2000)
    } catch (e) {
      alert(formatApiError(e, t('admin.saveSettingsError')))
    } finally {
      setSavingGroup(null)
    }
  }

  const loadStats = () => {
    adminApi
      .getStats()
      .then((r) => {
        setStats(r.data)
        setDbLimit(String(r.data.db_size_limit_mb || 0))
      })
      .catch(() => setStats(null))
  }

  const handleSaveLimit = async () => {
    setSavingLimit(true)
    try {
      const mb = Math.max(0, parseInt(dbLimit, 10) || 0)
      const res = await adminApi.setDbSizeLimit(mb)
      setStats((s) => ({ ...s, db_size_limit_mb: res.data.db_size_limit_mb }))
      setDbLimit(String(res.data.db_size_limit_mb))
    } catch (e) {
      alert(formatApiError(e, t('admin.saveLimitError')))
    } finally {
      setSavingLimit(false)
    }
  }

  const handleOpenCreate = () => {
    setCurrentUser(null)
    setFormData(EMPTY_FORM)
    setMcpToken(null)
    setCopied(false)
    setIsEditing(true)
  }

  const handleOpenEdit = (u) => {
    setCurrentUser(u)
    setFormData({
      username: u.username,
      password: '',
      role: u.role,
      webhooks_enabled: u.webhooks_enabled !== false,
    })
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
      alert(formatApiError(e, t('admin.tokenGenError')))
    }
  }

  const handleRevoke = async () => {
    try {
      await adminApi.mcpToken.revoke(currentUser.id)
      setMcpToken(null)
      if (onChanged) onChanged()
    } catch (e) {
      alert(formatApiError(e, t('admin.tokenRevokeError')))
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
      // Обновляем список пользователей (роль/переключатели могли измениться),
      // но НЕ закрываем саму панель администратора.
      if (onChanged) onChanged()
    } catch (err) {
      alert(formatApiError(err, t('admin.saveUserError')))
    }
  }

  const userName = (id) => users.find((u) => u.id === id)?.username || `#${id}`

  return (
    <Modal open={open} onClose={onBack} title={t('admin.title')} wide>
      <div>
        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-gray-200">
          {[
            ['users', t('admin.tabs.users')],
            ['webhooks', t('admin.tabs.webhooks')],
            ['server', t('admin.tabs.server')],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => openTab(key)}
              className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
                tab === key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'users' && (
          <div>
              <section className="bg-gray-50/50 rounded-lg p-4 mb-6 border">
                <h2 className="font-semibold mb-3 text-sm uppercase tracking-wider text-gray-500">{t('admin.serverSettings')}</h2>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowRegistration}
                    onChange={(e) => onToggleRegistration(e.target.checked)}
                    className="w-5 h-5"
                  />
                  <span className="text-sm">
                    {t('admin.allowRegistration')}
                    <span className="block text-xs text-gray-500">
                      {t('admin.allowRegistrationHint')}
                    </span>
                  </span>
                </label>
              </section>

              <div className="bg-card rounded-lg border overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-gray-50">
                    <tr className="text-xs uppercase text-gray-500">
                      <th className="p-4">{t('admin.colUser')}</th>
                      <th className="p-4 hidden sm:table-cell">{t('admin.colWebhooks')}</th>
                      <th className="p-2 sm:p-4 text-right">{t('admin.colActions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-gray-50">
                        <td className="p-2 sm:p-4 font-medium">{u.username}</td>
                        <td className="p-2 sm:p-4 text-sm">
                          <span className={u.webhooks_enabled === false ? 'text-red-500' : 'text-green-600'}>
                            {u.webhooks_enabled === false ? t('admin.forbidden') : t('admin.allowed')}
                          </span>
                        </td>
                        <td className="p-2 sm:p-4 text-right">
                          <div className="flex flex-col sm:flex-row items-end sm:items-center sm:justify-end gap-1 sm:gap-2">
                            <button
                              onClick={() => handleOpenEdit(u)}
                              className="text-blue-500 text-xs hover:underline whitespace-nowrap"
                            >
                              {t('admin.edit')}
                            </button>
                            <button
                              onClick={() => onDeleteUser(u.id)}
                              className="text-red-500 text-xs hover:underline whitespace-nowrap"
                            >
                              {t('common.delete')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end mt-4">
                <button
                  onClick={handleOpenCreate}
                  className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700 transition-colors whitespace-nowrap"
                >
                  {t('admin.createUser')}
                </button>
              </div>
          </div>
        )}

        {tab === 'webhooks' && (
          <div>
            <p className="text-xs text-gray-500 mb-3">
              {t('admin.hooksOverview')}
            </p>
            <div className="bg-card rounded-lg border overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50">
                  <tr className="text-xs uppercase text-gray-500">
                    <th className="p-4">{t('admin.colUser')}</th>
                    <th className="p-4">{t('admin.colBoard')}</th>
                    <th className="p-4">{t('admin.colName')}</th>
                    <th className="p-4 hidden sm:table-cell">URL</th>
                    <th className="p-4 hidden sm:table-cell">{t('admin.colEvents')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {(webhooks || []).map((w) => (
                    <tr key={w.id} className="hover:bg-gray-50">
                      <td className="p-2 sm:p-4 font-medium">{userName(w.user_id)}</td>
                      <td className="p-2 sm:p-4">{w.board_name || `#${w.board_id}`}</td>
                      <td className="p-2 sm:p-4">{w.name}</td>
                      <td
                        className="p-2 sm:p-4 text-xs text-gray-500 max-w-56 truncate"
                        title={w.url}
                      >
                        {w.url}
                      </td>
                      <td className="p-2 sm:p-4 text-xs text-gray-500">
                        {(w.events || []).length}
                      </td>
                    </tr>
                  ))}
                  {webhooks !== null && webhooks.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-4 text-sm text-gray-400 text-center">
                        {t('admin.noHooks')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isEditing && (
          <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-md p-6 relative">
              <h2 className="text-lg font-bold mb-4">
                {currentUser ? t('admin.editUserTitle') : t('admin.createUserTitle')}
              </h2>
              <form onSubmit={handleSaveUser} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t('admin.username')}</label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full p-2 border rounded"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('admin.password')}</label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full p-2 border rounded"
                    required={!currentUser}
                  />
                  {currentUser && <p className="text-[10px] text-gray-500 mt-1">{t('admin.passwordKeep')}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('admin.role')}</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full p-2 border rounded"
                  >
                    <option value="user">{t('admin.roleUser')}</option>
                    <option value="admin">{t('admin.roleAdmin')}</option>
                  </select>
                </div>
                {currentUser && (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.webhooks_enabled}
                      onChange={(e) =>
                        setFormData({ ...formData, webhooks_enabled: e.target.checked })
                      }
                      className="w-5 h-5"
                    />
                    <span className="text-sm">
                      {t('admin.allowWebhooks')}
                      <span className="block text-xs text-gray-500">
                        {t('admin.allowWebhooksHint')}
                      </span>
                    </span>
                  </label>
                )}

                {currentUser && (
                  <div className="border-t border-gray-200 pt-4 mt-4">
                    <div className="text-sm font-medium mb-1">{t('admin.mcpToken')}</div>
                    <p className="text-xs text-gray-500 mb-2">
                      {t('admin.mcpTokenHint')}
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
                          {copied ? t('admin.copied') : t('admin.copy')}
                        </button>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500 mb-2">
                        {currentUser.has_mcp_token ? t('admin.tokenSet') : t('admin.tokenNotSet')}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleRegenerate}
                        className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
                      >
                        {currentUser.has_mcp_token || mcpToken ? t('admin.generateNew') : t('admin.generateToken')}
                      </button>
                      {currentUser.has_mcp_token && !mcpToken && (
                        <button
                          type="button"
                          onClick={handleRevoke}
                          className="px-3 py-2 text-red-500 border border-red-500 rounded hover:bg-red-50 text-sm"
                        >
                          {t('admin.revoke')}
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
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    className="bg-green-600 text-white px-5 py-2 rounded hover:bg-green-700 font-medium"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {tab === 'server' && (
          <div>
            {!stats ? (
              <p className="text-sm text-gray-500">{t('admin.statsError')}</p>
            ) : (
              <div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                  {[
                    [t('admin.stats.dbSize'), formatBytes(stats.db, t)],
                    [t('admin.stats.wal'), formatBytes(stats.wal, t)],
                    [t('admin.stats.total'), formatBytes(stats.total, t)],
                    [t('admin.stats.uptime'), formatUptime(stats.uptime_seconds, t)],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-gray-50/50 border rounded-lg p-3 text-center">
                      <div className="text-xs text-gray-500">{label}</div>
                      <div className="font-semibold text-sm mt-1">{value}</div>
                    </div>
                  ))}
                </div>

                <section className="bg-gray-50/50 rounded-lg p-4 mb-4 border">
                  <h2 className="font-semibold mb-3 text-sm uppercase tracking-wider text-gray-500">
                    {t('admin.recordCounts')}
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[
                      [t('admin.stats.users'), stats.counts.users],
                      [t('admin.stats.boards'), stats.counts.boards],
                      [t('admin.stats.tasks'), stats.counts.tasks],
                      [t('admin.stats.lists'), stats.counts.lists],
                      [t('admin.stats.tags'), stats.counts.tags],
                      [t('admin.stats.webhooks'), stats.counts.webhooks],
                    ].map(([label, n]) => (
                      <div key={label} className="bg-card border rounded-lg p-3 flex justify-between items-center">
                        <span className="text-sm text-gray-600">{label}</span>
                        <span className="font-semibold text-sm">{n}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="bg-gray-50/50 rounded-lg p-4 mb-4 border">
                  <h2 className="font-semibold mb-3 text-sm uppercase tracking-wider text-gray-500">
                    {t('admin.dbLimit')}
                  </h2>
                  <div className="flex items-end gap-2">
                    <label className="flex-1">
                      <span className="block text-xs text-gray-500 mb-1">
                        {t('admin.dbLimitHint')}
                      </span>
                      <input
                        type="number"
                        min="0"
                        value={dbLimit}
                        onChange={(e) => setDbLimit(e.target.value)}
                        className="w-full p-2 border rounded text-sm"
                      />
                    </label>
                    <button
                      onClick={handleSaveLimit}
                      disabled={savingLimit}
                      className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {t('common.save')}
                    </button>
                  </div>
                </section>

                {tunable ? (
                  TUNABLE_GROUPS.map((group) => (
                    <section
                      key={group.key}
                      className="bg-gray-50/50 rounded-lg p-4 mb-4 border"
                    >
                      <h2 className="font-semibold mb-3 text-sm uppercase tracking-wider text-gray-500">
                        {t(`admin.groups.${group.key}`)}
                      </h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {group.fields.map((f) =>
                          f.bool ? (
                            <label
                              key={f.key}
                              className={`flex items-start gap-2 text-sm ${
                                f.danger ? 'text-red-600' : 'text-gray-700'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={Boolean(tunable[f.key])}
                                onChange={(e) =>
                                  setTunable({ ...tunable, [f.key]: e.target.checked })
                                }
                                className="mt-0.5"
                              />
                              <span>{t(`admin.settings.${f.key}`)}</span>
                            </label>
                          ) : (
                            <label key={f.key} className="text-xs text-gray-500">
                              {t(`admin.settings.${f.key}`)}
                              <input
                                type="number"
                                min={f.min}
                                max={f.max}
                                value={tunable[f.key] ?? ''}
                                onChange={(e) =>
                                  setTunable({ ...tunable, [f.key]: e.target.value })
                                }
                                className="mt-1 w-full p-2 border rounded text-sm text-gray-800"
                              />
                            </label>
                          )
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-3">
                        <button
                          onClick={() => handleSaveGroup(group)}
                          disabled={savingGroup === group.key}
                          className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 transition-colors disabled:opacity-50"
                        >
                          {t('common.save')}
                        </button>
                        {savedGroup === group.key && (
                          <span className="text-sm text-green-600">{t('admin.saved')}</span>
                        )}
                        {group.key === 'security' && tunable.maintenance_mode && (
                          <span className="text-xs text-red-500">
                            {t('admin.maintenanceOn')}
                          </span>
                        )}
                      </div>
                    </section>
                  ))
                ) : (
                  <p className="text-sm text-gray-500 mb-4">{t('admin.loadingSettings')}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
