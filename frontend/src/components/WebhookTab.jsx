import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { boardsApi } from '../api/client'
import { formatApiError } from '../api/errors'

// «Веб-хуки» tab of the board editor: exactly one webhook per board (upsert).
// The admin can revoke the right per user; a revoked user has no tab and
// their webhook parameters are wiped server-side.

// Ключи событий лежат в словаре под webhooks.events.*
const WEBHOOK_EVENTS = [
  'task_created',
  'task_updated',
  'task_completed',
  'task_deleted',
  'priority_changed',
  'deadline_approaching',
  'task_overdue',
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
  const { t } = useTranslation()
  const toggle = (ev) => {
    onChange(value.includes(ev) ? value.filter((e) => e !== ev) : [...value, ev])
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 border rounded p-2 max-h-40 overflow-y-auto">
      {WEBHOOK_EVENTS.map((ev) => (
        <label key={ev} className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={value.includes(ev)}
            onChange={() => toggle(ev)}
          />
          <span>{t(`webhooks.events.${ev}`)}</span>
        </label>
      ))}
    </div>
  )
}

export default function WebhookTab({ board }) {
  const { t } = useTranslation()
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

  if (!loaded) return <p className="text-sm text-slate-500">{t('webhooks.loading')}</p>

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await boardsApi.webhook.put(board.id, {
        ...data,
        name: data.name || t('webhooks.boardDefaultName', { name: board.name }),
      })
      setExists(true)
      setMessage(t('webhooks.saved'))
    } catch (e) {
      setError(formatApiError(e, t('webhooks.saveError')))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(t('webhooks.deleteConfirm'))) return
    try {
      await boardsApi.webhook.remove(board.id)
      setExists(false)
      setData(EMPTY)
      setError('')
      setMessage(t('webhooks.deleted'))
    } catch (e) {
      setError(formatApiError(e, t('webhooks.deleteError')))
    }
  }

  const test = async () => {
    setTesting(true)
    setError('')
    setMessage('')
    try {
      const r = await boardsApi.webhook.test(board.id)
      if (r.data.ok) {
        setMessage(t('webhooks.testSent', { code: r.data.status_code }))
      } else {
        setError(t('webhooks.testError', { error: r.data.error || t('webhooks.testUnknown') }))
      }
    } catch (e) {
      setError(formatApiError(e, t('webhooks.testSendError')))
    } finally {
      setTesting(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <p className="text-xs text-slate-500">
        {t('webhooks.intro')}
      </p>
      <div>
        <label className="block text-sm font-medium mb-1">{t('webhooks.name')}</label>
        <input
          type="text"
          value={data.name}
          onChange={(e) => setData({ ...data, name: e.target.value })}
          className="w-full p-2 border rounded"
          placeholder={t('webhooks.namePlaceholder')}
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
        <label className="block text-sm font-medium mb-1">{t('webhooks.secret')}</label>
        <input
          type="text"
          value={data.token}
          onChange={(e) => setData({ ...data, token: e.target.value })}
          className="w-full p-2 border rounded"
          placeholder={t('webhooks.secretPlaceholder')}
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
            placeholder={t('webhooks.chatIdPlaceholder')}
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
            placeholder={t('webhooks.urlPlaceholder')}
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">{t('webhooks.eventsTitle')}</label>
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
            {t('common.delete')}
          </button>
        ) : <span />}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={test}
            disabled={!exists || testing}
            className="border border-green-600 text-green-600 px-4 py-2 rounded hover:bg-green-50 disabled:opacity-50"
          >
            {testing ? t('webhooks.sending') : t('webhooks.test')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-green-600 text-white px-5 py-2 rounded hover:bg-green-700 font-medium disabled:opacity-50"
          >
            {saving ? t('webhooks.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </form>
  )
}
