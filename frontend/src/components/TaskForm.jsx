import { useState, useEffect, useMemo, useRef } from 'react'
import { tasksApi, currenciesApi } from '../api/client'
import TagInput from './TagInput'
import TaskLinkInput from './TaskLinkInput'
import Modal from './Modal'
import DateTimePicker from './DateTimePicker'
import Markdown from './Markdown'
import { formatAmount } from '../utils/format'

const LISTS_FALLBACK = ['Входящие', 'В планах', 'В работе', 'На проверке', 'Готово']

const PRIORITY_LABELS = { 1: 'Низкий', 2: 'Средний', 3: 'Высокий' }
const MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']

// «2025-10-12» → «12 окт. 2025»
function fmtLogDate(value) {
  if (!value) return '—'
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`
}

// «2025-10-12T14:30» → «12.10.2025 14:30»
function fmtLogDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (isNaN(d.getTime())) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// Строка истории по записи лога (field, old_value, new_value)
function describeChange(c) {
  if (c.field === 'description') return 'Описание задания изменено'
  if (c.field === 'priority') {
    return `Приоритет: «${PRIORITY_LABELS[Number(c.old_value)] || '—'}» → «${PRIORITY_LABELS[Number(c.new_value)] || '—'}»`
  }
  if (c.field === 'amount') {
    const f = (v) => (v == null ? '—' : `${Number(v) > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(Number(v)).toLocaleString('ru-RU')}`)
    return `Сумма: «${f(c.old_value)}» → «${f(c.new_value)}»`
  }
  if (c.field === 'list') {
    return `Статус: «${c.old_value || '—'}» → «${c.new_value || '—'}»`
  }
  const label = c.field === 'start_date' ? 'Дата начала' : 'Дата завершения'
  return `${label}: «${c.old_value ? fmtLogDate(c.old_value) : '—'}» → «${c.new_value ? fmtLogDate(c.new_value) : '—'}»`
}

const EMPTY = {
  title: '',
  description: '',
  start_date: '',
  deadline: '',
  priority: 1,
  tag: '',
  list: '',
  blocked_by: [],
}
function toDatetimeLocal(value) {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export default function TaskForm({ open, onClose, onSubmit, task, tasks = [], lists = [], tags = [], initialTags = [], boards = [], defaultBoardId = null, onMove, onQuickUpdate, initialList = null }) {
  const [form, setForm] = useState(EMPTY)
  const [selectedTags, setSelectedTags] = useState([])
  const [selectedBlockers, setSelectedBlockers] = useState([])
  // Финансовый вес: направление (доход + / расход -) и сумма (только положительная)
  const [amountType, setAmountType] = useState('expense')
  const [amountStr, setAmountStr] = useState('')
  // Компактный режим строки суммы на мобильных: переключатель Доход/Расход
  // сворачивается в кнопку-знак (+/−), освобождая место полю ввода
  const [amountCompact, setAmountCompact] = useState(false)
  // Валюта суммы (мультивалютность): список подгружается с бэкенда
  const [currencies, setCurrencies] = useState([])
  const [currencyId, setCurrencyId] = useState(null)
  // Целевая доска для переноса задачи (только в режиме редактирования)
  const [targetBoardId, setTargetBoardId] = useState(null)
  // Предпросмотр Markdown описания: в «Изменить задачу» открываем сразу
  // в предпросмотре (удобно ознакомиться с оформленным текстом),
  // в «Создать задачу» — сразу в редакторе.
  const [descPreview, setDescPreview] = useState(false)

  const listOptions = useMemo(() => 
    lists.length ? lists : LISTS_FALLBACK.map((n) => ({ name: n, color: '#64748b' })), 
    [lists]
  )

  // Валюты пользователя (для селектора у суммы) — один раз при монтировании
  useEffect(() => {
    currenciesApi
      .list()
      .then((res) => setCurrencies(res.data || []))
      .catch(() => setCurrencies([]))
  }, [])

  // Символ выбранной валюты (для подсказки в поле суммы)
  const currencySymbol = currencies.find((c) => c.id === currencyId)?.symbol || ''

  // Компактный режим строки суммы на узких экранах (< ~480px)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(max-width: 479px)')
    const apply = () => setAmountCompact(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const [changes, setChanges] = useState([])

  // Снапшот listOptions для сброса формы: ref позволяет не включать listOptions
  // в зависимости эффекта инициализации — иначе после быстрого обновления
  // (чекбоксы в предпросмотре) перезагрузка списков пересоздавала бы массив
  // и эффект затирал бы несохранённые правки формы старым описанием задачи.
  const listOptionsRef = useRef(listOptions)
  listOptionsRef.current = listOptions

  // Инициализация формы — один раз на открытие (open + конкретная задача),
  // а не на каждую смену ссылок task/listOptions (см. комментарий выше).
  const initKeyRef = useRef(null)

  useEffect(() => {
    if (!open) {
      initKeyRef.current = null
      return
    }
    const initKey = task ? `task:${task.id}` : `new:${defaultBoardId ?? ''}:${initialList ?? ''}`
    if (initKeyRef.current === initKey) return
    initKeyRef.current = initKey
    const listOptions = listOptionsRef.current
    setChanges([])
    if (task) {
      tasksApi.changes(task.id)
        .then((res) => setChanges(res.data))
        .catch(() => setChanges([]))
    }
    if (task) {
      setForm({
        title: task.title || '',
        description: task.description || '',
        start_date: toDatetimeLocal(task.start_date),
        deadline: toDatetimeLocal(task.deadline),
        priority: task.priority ?? 1,
        list: task.list || listOptions[0]?.name || '',
        blocked_by: task.blocked_by || [],
      })
      const amt = Number(task.amount) || 0
      setAmountType(amt < 0 ? 'expense' : 'income')
      setAmountStr(amt !== 0 ? String(Math.abs(amt)) : '')
      setCurrencyId(task.currency_id ?? null)
      setTargetBoardId(task.board_id ?? null)
      setDescPreview(true)
      setSelectedTags((task.tags || []).map((t) => (typeof t === 'string' ? t : t.name)))
      setSelectedBlockers(task.blocked_by || [])
    } else {
      setForm({ ...EMPTY, list: initialList || listOptions[0]?.name || '' })
      setSelectedTags([...initialTags])
      setSelectedBlockers([])
      setAmountType('expense')
      setAmountStr('')
      // Валюта по умолчанию — первая в пользовательском порядке
      setCurrencyId(currencies[0]?.id ?? null)
      setTargetBoardId(defaultBoardId ?? null)
      setDescPreview(false)
    }
  }, [open, task, defaultBoardId, initialList])

  if (!open) return null

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  // Переключение чекбокса GFM-задачи (- [ ] / - [x]) в предпросмотре:
  // правит markdown-источник в форме и сразу сохраняет у существующей задачи.
  const handleToggleCheckItem = async (index, checked) => {
    const lines = String(form.description || '').split('\n')
    let seen = -1
    const newLines = lines.map((line) => {
      const m = line.match(/^(\s*[-*+]\s+)\[( |x|X)\](\s+.*)$/)
      if (!m) return line
      seen += 1
      if (seen !== index) return line
      return `${m[1]}[${checked ? 'x' : ' '}]${m[3]}`
    })
    if (seen < index) return // нет такого чекбокса в источнике
    const newText = newLines.join('\n')
    setForm((f) => ({ ...f, description: newText }))
    if (task && onQuickUpdate) {
      try {
        await onQuickUpdate(task.id, { description: newText })
      } catch {
        // ошибка не должна ломать предпросмотр; при сохранении формы текст уйдёт снова
      }
    }
  }

  // Сумма в БД: доход — положительное число, расход — отрицательное.
  const computeAmount = () => {
    const v = parseFloat(String(amountStr).replace(',', '.'))
    if (!v || v <= 0 || isNaN(v)) return 0
    return amountType === 'income' ? v : -v
  }

  const submit = async (e) => {
    e.preventDefault()
    // Перенос задачи на другую доску: отдаем наружу и закрываем форму
    if (task && onMove && targetBoardId != null && Number(targetBoardId) !== task.board_id) {
      onMove(task, Number(targetBoardId))
      onClose()
      return
    }
    // Collect only changed fields to avoid overwriting with nulls/defaults
    const payload = {}
    if (!task || form.title !== task.title) payload.title = form.title
    if (!task || form.description !== (task.description || '')) payload.description = form.description || null
    if (!task || form.start_date !== toDatetimeLocal(task.start_date)) payload.start_date = form.start_date || null
    if (!task || form.deadline !== toDatetimeLocal(task.deadline)) payload.deadline = form.deadline || null
    if (!task || Number(form.priority) !== task.priority) payload.priority = Number(form.priority)
    if (!task || form.list !== (task.list || '')) payload.list = form.list || listOptions[0]?.name || 'Не начато'
    if (!task || JSON.stringify(selectedBlockers) !== JSON.stringify(task.blocked_by || [])) {
      payload.blocked_by = selectedBlockers
    }

    const origTags = (task?.tags || []).map((t) => (typeof t === 'string' ? t : t.name)).sort()
    const newTags = [...selectedTags].sort()
    const tagsChanged = JSON.stringify(origTags) !== JSON.stringify(newTags)

    // For a new task we always need the required fields + tags + blockers.
    if (!task) {
      payload.title = form.title
      payload.priority = Number(form.priority)
      payload.list = form.list || listOptions[0]?.name || 'Не начато'
      payload.tags = selectedTags
      payload.blocked_by = selectedBlockers
    } else if (tagsChanged) {
      payload.tags = selectedTags
    }

    // Финансовый вес: отправляем при изменении (или всегда для новой задачи)
    const newAmount = computeAmount()
    if (!task || newAmount !== (Number(task.amount) || 0)) payload.amount = newAmount
    // Валюта суммы: отправляем при изменении (или всегда для новой задачи);
    // без суммы валюта не имеет смысла — сбрасываем в базовую (NULL)
    if (!task || currencyId !== (task.currency_id ?? null)) {
      payload.currency_id = newAmount === 0 ? null : currencyId
    }

    onSubmit(payload)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={task ? 'Изменить задачу' : 'Создать задачу'}>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Название</label>
            <input
              type="text"
              id="task-title"
              name="title"
              placeholder="Введите название задачи"
              value={form.title}
              onChange={update('title')}
              className="w-full p-2 border rounded"
              required
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Дата начала</label>
            <DateTimePicker
              id="task-start-date"
              name="start_date"
              value={form.start_date}
              onChange={update('start_date')}
              placeholder="Не указана"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Дата завершения</label>
            <DateTimePicker
              id="task-deadline"
              name="deadline"
              value={form.deadline}
              onChange={update('deadline')}
              placeholder="Не указана"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Приоритет</label>
            <select
              id="task-priority"
              name="priority"
              value={form.priority}
              onChange={update('priority')}
              className="w-full p-2 border rounded"
            >
              <option value={1}>Низкий</option>
              <option value={2}>Средний</option>
              <option value={3}>Высокий</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Статус</label>
            <select
              id="task-list"
              name="list"
              value={form.list}
              onChange={update('list')}
              className="w-full p-2 border rounded"
            >
              {listOptions.map((l) => (
                <option key={l.name} value={l.name} disabled={l.kind === 'regular'}>
                  {l.name}{l.kind === 'regular' ? ' — только для циклических' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Сумма (финансовый вес)</label>
            <div className="flex gap-2">
              {/* Доход/Расход: на мобильных — кнопка-знак (+/−), на десктопе — переключатель */}
              {amountCompact ? (
                <button
                  type="button"
                  onClick={() => setAmountType(amountType === 'income' ? 'expense' : 'income')}
                  title={amountType === 'income' ? 'Доход (нажмите для расхода)' : 'Расход (нажмите для дохода)'}
                  className={`w-11 shrink-0 rounded text-lg font-bold text-white transition-colors ${
                    amountType === 'income' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-red-500 hover:bg-red-600'
                  }`}
                >
                  {amountType === 'income' ? '+' : '−'}
                </button>
              ) : (
                <div className="flex rounded overflow-hidden border border-slate-200 shrink-0">
                  <button
                    type="button"
                    onClick={() => setAmountType('income')}
                    className={`px-3 text-sm font-medium transition-colors ${
                      amountType === 'income'
                        ? 'bg-blue-500 text-white'
                        : 'bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    Доход
                  </button>
                  <button
                    type="button"
                    onClick={() => setAmountType('expense')}
                    className={`px-3 text-sm font-medium transition-colors ${
                      amountType === 'expense'
                        ? 'bg-red-500 text-white'
                        : 'bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    Расход
                  </button>
                </div>
              )}
              {/* Поле суммы: рамка-контейнер (синяя/красная), символ валюты — в потоке,
                  без абсолютного оверлея (раньше он дублировал и наслаивался на ввод) */}
              <div
                className={`flex flex-1 min-w-0 items-center border rounded ${
                  amountType === 'income' ? 'border-blue-300' : 'border-red-300'
                }`}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={amountStr}
                  onChange={(e) => {
                    // только положительные числа (точка/запятая как разделитель)
                    const v = e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.')
                    if (/^\d*(\.\d*)?$/.test(v)) setAmountStr(v)
                  }}
                  className="w-full min-w-0 bg-transparent p-2 border-0 outline-none focus:ring-0"
                />
                {currencySymbol && (
                  <span className="pr-2 text-sm text-slate-400 shrink-0">{currencySymbol}</span>
                )}
              </div>
              {/* Валюта операции (из «Параметров валют» пользователя) */}
              <select
                value={currencyId ?? ''}
                onChange={(e) => setCurrencyId(e.target.value ? Number(e.target.value) : null)}
                className="p-2 border rounded text-sm shrink-0"
                style={amountCompact ? { maxWidth: '5.5rem' } : undefined}
                title="Валюта суммы"
              >
                {currencies.length === 0 && <option value="">—</option>}
                {currencies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="md:col-span-2">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Описание</label>
              <button
                type="button"
                onClick={() => setDescPreview((v) => !v)}
                className="px-2 py-0.5 rounded border text-[10px] font-medium transition-colors bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200"
              >
                {descPreview ? '✎ Редактировать' : '👁 Предпросмотр'}
              </button>
            </div>
            {descPreview ? (
              <div className="w-full min-h-[6rem] p-2 border rounded bg-slate-50">
                {form.description?.trim() ? (
                  <Markdown
                    text={form.description}
                    onToggleCheckItem={handleToggleCheckItem}
                  />
                ) : (
                  <p className="text-xs text-slate-400">Описание пусто</p>
                )}
              </div>
            ) : (
            <textarea
              id="task-description"
              name="description"
              placeholder="Введите описание задачи (поддерживается Markdown: **жирный**, *курсив*, списки, [ссылки](url), `код`)"
              value={form.description}
              onChange={update('description')}
              className="w-full p-2 border rounded leading-relaxed"
            />
            )}
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Теги</label>
            <TagInput
              value={selectedTags}
              availableTags={tags}
              takenColors={listOptions.map((l) => l.color)}
              onChange={setSelectedTags}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Блокирующие задачи</label>
            <TaskLinkInput
              value={selectedBlockers}
              tasks={tasks}
              excludeId={task?.id}
              onChange={setSelectedBlockers}
            />
            <p className="text-xs text-gray-500 mt-1">
              Эти задачи должны быть выполнены до того, как данную можно будет отметить «Готово».
            </p>
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Доска</label>
            <select
              id="task-board"
              value={targetBoardId ?? ''}
              onChange={(e) => setTargetBoardId(Number(e.target.value))}
              className="w-full p-2 border rounded"
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              При переносе сбрасываются теги и блокирующие связи.
            </p>
          </div>
      <div className="md:col-span-2 flex justify-between items-center mt-4">
        <button
          type="button"
          onClick={() => {
            if (task && confirm(`Вы уверены, что хотите удалить задачу «${task.title}»?`)) {
              onSubmit({ _action: 'delete' })
            }
          }}
          disabled={!task}
          className="px-4 py-2 text-red-500 hover:text-red-600 hover:bg-red-50 rounded font-medium transition-colors"
        >
          Удалить
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded"
          >
            Отмена
          </button>
          <button
            type="submit"
            className="bg-green-600 text-white px-5 py-2 rounded hover:bg-green-700 font-medium"
          >
            {task ? 'Сохранить' : 'Создать задачу'}
          </button>
        </div>
      </div>
      {/* История изменений дат/приоритета/описания (хронологическая) — на всю ширину формы */}
      {task && (
        <div className="md:col-span-2 mt-4 pt-3 border-t border-slate-200">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
            История изменений
          </h4>
          {changes.length === 0 ? (
            <p className="text-xs text-slate-400">Изменений ещё не было.</p>
          ) : (
            <div className="max-h-44 overflow-y-auto overscroll-contain rounded border border-slate-100 divide-y divide-slate-100">
              {/* свежие записи сверху; ползунок прокрутки — в верхнем положении */}
              {[...changes].reverse().map((c) => (
                <div key={c.id} className="px-2 py-1.5 text-xs text-slate-600 flex justify-between gap-2">
                  <span>{describeChange(c)}</span>
                  <span className="text-slate-400 shrink-0">{fmtLogDateTime(c.changed_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </form>
    </Modal>
  )
}
