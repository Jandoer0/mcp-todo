// Formatting API errors into human-readable Russian messages for alerts.
// FastAPI returns `detail` as a string (HTTPException) or as an array of
// pydantic validation objects (422) — the latter used to render as
// "[object Object]" in alert() dialogs.

const FIELD_LABELS = {
  name: 'Название',
  url: 'URL',
  token: 'Секрет подписи',
  chat_id: 'Telegram Chat ID',
  thread_id: 'Thread ID',
  user_id: 'Пользователь',
  board_id: 'Доска',
  events: 'События',
  excluded_events: 'Исключённые события',
  username: 'Имя пользователя',
  password: 'Пароль',
  role: 'Роль',
  title: 'Название задачи',
}

// pydantic v2 error "type" → readable Russian message
const TYPE_MESSAGES = {
  missing: 'обязательно для заполнения',
  int_parsing: 'должно быть числом',
  int_type: 'должно быть числом',
  string_type: 'должно быть строкой',
  string_too_long: 'слишком длинное',
  string_too_short: 'слишком короткое',
  url_type: 'некорректный URL',
  url_parsing: 'некорректный URL',
  json_invalid: 'некорректный JSON',
}

function labelFor(loc) {
  const field = Array.isArray(loc) ? loc.filter((p) => p !== 'body').join('.') : ''
  return FIELD_LABELS[field] || field
}

function describeIssue(e) {
  const label = labelFor(e?.loc)
  if (e?.type === 'value_error' && typeof e?.msg === 'string') {
    // pydantic wraps our ValueError as "Value error, <message>"; our backend
    // messages are already full, self-descriptive sentences — use them as-is.
    return e.msg.replace(/^Value error,\s*/, '')
  }
  const msg = TYPE_MESSAGES[e?.type] || e?.msg || 'некорректное значение'
  return label ? `${label} — ${msg}` : msg
}

export function formatApiError(err, fallback = 'Произошла ошибка') {
  // Network failure / server unreachable (err.response is undefined)
  if (err && err.response === undefined && (err.request || err.message)) {
    return 'Сервер недоступен. Проверьте соединение и попробуйте ещё раз.'
  }
  const status = err?.response?.status
  const detail = err?.response?.data?.detail

  if (typeof detail === 'string' && detail.trim()) return detail

  if (Array.isArray(detail) && detail.length) {
    return detail.map(describeIssue).join('; ')
  }

  // Non-string, non-array detail (unexpected object) — dump its readable parts
  if (detail && typeof detail === 'object') {
    const parts = Object.entries(detail).map(
      ([k, v]) => `${FIELD_LABELS[k] || k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`,
    )
    if (parts.length) return parts.join('; ')
  }

  if (status === 422) return 'Проверьте правильность заполнения полей формы.'
  if (status === 401 || status === 403) return 'Недостаточно прав. Войдите заново.'
  if (status >= 500) return 'Ошибка на сервере. Попробуйте позже.'

  // err.message may itself be an object/array (e.g. non-axios errors)
  const msg = err?.message ?? err
  if (typeof msg === 'string' && msg.trim()) return msg
  if (msg !== undefined && msg !== null) return JSON.stringify(msg)

  return fallback
}
