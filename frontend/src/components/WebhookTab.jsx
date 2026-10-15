import { useEffect, useState } from 'react'
import { boardsApi } from '../api/client'
import { formatApiError } from '../api/errors'

// «Веб-хуки» tab of the board editor: exactly one webhook per board (upsert).
// The admin can revoke the right per user; a revoked user has no tab and
// their webhook parameters are wiped server-side.

const WEBHOOK_EVENTS = [
  ['task_created', 'Создание задачи'],
  ['task_updated', 'Изменение задачи'],
  ['task_completed', 'Выполнение задачи'],
  ['task_deleted', 'Удаление задачи'],
  ['priority_changed', 'Изменение приоритета'],
  ['deadline_approaching', 'Приближение дедлайна (<24ч)'],
  ['task_overdue', 'Просрочка задачи'],
]

const EMPTY = {
  name: '',
  url: '',
  token: '',
  chat_id: '',
  thread_id: '',
  events: [],
  // excluded_events всегда пуст — набор событий определяется только чекбоксами «События»
  excluded_events: [],
}

function EventMultiSelect({ value, onChange }) {
  const toggle = (ev) => {
    onChange(value.includes(ev) ? value.filter((e) => e !== ev) : [...value, ev])
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

export default function WebhookTab({ board }) {
  const [data, setData] = useState(EMPTY)
  const [exists, setExists] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!board?.id) return
    boardsApi.webhook
      .get(board.id)
      .then((r) => {
        const w = r.data
        setExists(!!w)
        setData(
          w
            ? {
                name: w.name || '',
                url: w.url || '',
                token: w.token || '',
                chat_id: w.chat_id || '',
                thread_id: w.thread_id || '',
                events: w.events || [],
                // существующие исключения не тянем в форму: набор событий задаётся только чекбоксами
                excluded_events: [],
              }
            : EMPTY,
        )
        setLoaded(true)
        setError('')
        setMessage('')
      })
      .catch(() => {
        // 404-like: no webhook configured yet
        setExists(false)
        setData(EMPTY)
        setLoaded(true)
      })
  }, [board])

  if (!loaded) return <p className="text-sm text-slate-500">Загрузка…</p>

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await boardsApi.webhook.put(board.id, {
        ...data,
        name: data.name || `Доска «${board.name}»`,
      })
      setExists(true)
      setMessage('Веб-хук сохранён.')
    } catch (e) {
      setError(formatApiError(e, 'Ошибка при сохранении веб-хука'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!window.confirm('Удалить параметры веб-хука этой доски?')) return
    try {
      await boardsApi.webhook.remove(board.id)
      setExists(false)
      setData(EMPTY)
      setError('')
      setMessage('Веб-хук удалён.')
    } catch (e) {
      setError(formatApiError(e, 'Ошибка при удалении веб-хука'))
    }
  }

  const test = async () => {
    setTesting(true)
    setError('')
    setMessage('')
    try {
      const r = await boardsApi.webhook.test(board.id)
      if (r.data.ok) {
        setMessage(`Тестовое уведомление отправлено (HTTP ${r.data.status_code}).`)
      } else {
        setError(`Ошибка доставки: ${r.data.error || 'неизвестная ошибка'}`)
      }
    } catch (e) {
      setError(formatApiError(e, 'Ошибка отправки теста'))
    } finally {
      setTesting(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <p className="text-xs text-slate-500">
        Уведомления о событиях задач этой доски отправляются на указанный URL
        (POST JSON, подпись HMAC-SHA256 в заголовке X-Hub-Signature-256).
        Один веб-хук на доску.
      </p>
      <div>
        <label className="block text-sm font-medium mb-1">Название</label>
        <input
          type="text"
          value={data.name}
          onChange={(e) => setData({ ...data, name: e.target.value })}
          className="w-full p-2 border rounded"
          placeholder="Например: уведомления в Telegram"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">URL</label>
        <input
          type="url"
          value={data.url}
          onChange={(e) => setData({ ...data, url: e.target.value })}
          className="w-full p-2 border rounded"
          placeholder="https://…"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Секрет подписи (HMAC)</label>
        <input
          type="text"
          value={data.token}
          onChange={(e) => setData({ ...data, token: e.target.value })}
          className="w-full p-2 border rounded"
          placeholder="необязательно — ключ HMAC-SHA256"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Telegram Chat ID</label>
          <input
            type="text"
            value={data.chat_id}
            onChange={(e) => setData({ ...data, chat_id: e.target.value })}
            className="w-full p-2 border rounded"
            placeholder="например: -1001234567890"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Thread ID</label>
          <input
            type="text"
            value={data.thread_id}
            onChange={(e) => setData({ ...data, thread_id: e.target.value })}
            className="w-full p-2 border rounded"
            placeholder="необязательно"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">События</label>
        <EventMultiSelect
          value={data.events}
          onChange={(events) => setData({ ...data, events })}
        />
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {message && <p className="text-sm text-green-600">{message}</p>}
      <div className="flex justify-between items-center">
        {exists ? (
          <button
            type="button"
            onClick={remove}
            className="px-4 py-2 text-red-500 hover:text-red-600 hover:bg-red-50 rounded font-medium transition-colors"
          >
            Удалить
          </button>
        ) : <span />}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={test}
            disabled={!exists || testing}
            className="border border-green-600 text-green-600 px-4 py-2 rounded hover:bg-green-50 disabled:opacity-50"
          >
            {testing ? 'Отправка…' : 'Тест'}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-green-600 text-white px-5 py-2 rounded hover:bg-green-700 font-medium disabled:opacity-50"
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </form>
  )
}
