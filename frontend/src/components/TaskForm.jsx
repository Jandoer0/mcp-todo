import { useState, useEffect, useMemo } from 'react'
import { tasksApi } from '../api/client'
import TagInput from './TagInput'
import TaskLinkInput from './TaskLinkInput'
import Modal from './Modal'
import DateTimePicker from './DateTimePicker'
import Markdown from './Markdown'

const LISTS_FALLBACK = ['Входящие', 'В планах', 'В работе', 'На проверке', 'Готово']

const PRIORITY_LABELS = { 1: 'Низкий', 2: 'Средний', 3: 'Высокий' }
const CURRENCY = '₽'

// «-10000» → «-10 000» (только для отображения в маркере)
export function formatAmount(v) {
  const n = Number(v) || 0
  const sign = n < 0 ? '-' : '+'
  return `${sign}${Math.abs(n).toLocaleString('ru-RU')}`
}
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
  is_cyclic: false,
  cycle_period: 'monthly',
  cycle_interval: 1,
  reminder_days: 0,
}
function toDatetimeLocal(value) {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export default function TaskForm({ open, onClose, onSubmit, task, tasks = [], lists = [], tags = [], initialTags = [], boards = [], onMove }) {
  const [form, setForm] = useState(EMPTY)
  const [selectedTags, setSelectedTags] = useState([])
  const [selectedBlockers, setSelectedBlockers] = useState([])
  // Финансовый вес: направление (доход + / расход -) и сумма (только положительная)
  const [amountType, setAmountType] = useState('expense')
  const [amountStr, setAmountStr] = useState('')
  // Целевая доска для переноса задачи (только в режиме редактирования)
  const [targetBoardId, setTargetBoardId] = useState(null)
  // Предпросмотр Markdown описания
  const [descPreview, setDescPreview] = useState(false)

  const listOptions = useMemo(() => 
    lists.length ? lists : LISTS_FALLBACK.map((n) => ({ name: n, color: '#64748b' })), 
    [lists]
  )

  const [changes, setChanges] = useState([])

  useEffect(() => {
    if (!open) return
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
        is_cyclic: task.is_cyclic || false,
        cycle_period: task.cycle_period || 'monthly',
        cycle_interval: task.cycle_interval || 1,
        reminder_days: task.reminder_days || 0,
      })
      const amt = Number(task.amount) || 0
      setAmountType(amt < 0 ? 'expense' : 'income')
      setAmountStr(amt !== 0 ? String(Math.abs(amt)) : '')
      setTargetBoardId(task.board_id ?? null)
      setDescPreview(false)
      setSelectedTags((task.tags || []).map((t) => (typeof t === 'string' ? t : t.name)))
      setSelectedBlockers(task.blocked_by || [])
    } else {
      setForm({ ...EMPTY, list: listOptions[0]?.name || '' })
      setSelectedTags([...initialTags])
      setSelectedBlockers([])
      setAmountType('expense')
      setAmountStr('')
      setTargetBoardId(null)
      setDescPreview(false)
    }
  }, [open, task, listOptions])

  if (!open) return null

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

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

    // Cyclic settings: send when changed or when enabling cyclicity.
    const cycleChanged =
      !task ||
      form.is_cyclic !== !!task.is_cyclic ||
      form.cycle_period !== (task.cycle_period || 'monthly') ||
      Number(form.cycle_interval) !== (task.cycle_interval || 1) ||
      Number(form.reminder_days) !== (task.reminder_days || 0)
    if (cycleChanged) {
      payload.is_cyclic = form.is_cyclic
      payload.cycle_period = form.cycle_period
      payload.cycle_interval = Number(form.cycle_interval) || 1
      payload.reminder_days = Number(form.reminder_days) || 0
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
          <div className="md:col-span-2 border-t border-slate-200 pt-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_cyclic}
                onChange={(e) => setForm((f) => ({ ...f, is_cyclic: e.target.checked }))}
                className="w-4 h-4"
              />
              <span className="text-sm font-semibold">Циклическая задача</span>
              <span className="text-xs text-slate-400">— будет автоматически создаваться заново</span>
            </label>
            {form.is_cyclic && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Период</label>
                  <select
                    value={form.cycle_period}
                    onChange={(e) => setForm((f) => ({ ...f, cycle_period: e.target.value }))}
                    className="w-full p-2 border rounded text-sm"
                  >
                    <option value="daily">Ежедневно</option>
                    <option value="weekly">Еженедельно</option>
                    <option value="monthly">Ежемесячно</option>
                    <option value="yearly">Ежегодно</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Каждые N периодов</label>
                  <input
                    type="number"
                    min={1}
                    value={form.cycle_interval}
                    onChange={(e) => setForm((f) => ({ ...f, cycle_interval: e.target.value }))}
                    className="w-full p-2 border rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Показывать за (дней)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.reminder_days}
                    onChange={(e) => setForm((f) => ({ ...f, reminder_days: e.target.value }))}
                    className="w-full p-2 border rounded text-sm"
                  />
                </div>
              </div>
            )}
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
                <option key={l.name} value={l.name}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Сумма (финансовый вес)</label>
            <div className="flex gap-2">
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
              <div className="relative flex-1">
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
                  className={`w-full p-2 border rounded ${amountType === 'income' ? 'border-blue-300' : 'border-red-300'}`}
                />
                {amountStr && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">
                    {amountType === 'income' ? '+' : '-'}{amountStr} {CURRENCY}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="md:col-span-2">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Описание</label>
              <button
                type="button"
                onClick={() => setDescPreview((v) => !v)}
                className={`px-2 py-0.5 rounded border text-[10px] font-medium transition-colors ${
                  descPreview
                    ? 'bg-blue-500 border-blue-500 text-white hover:bg-blue-600'
                    : 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {descPreview ? '✎ Редактировать' : '👁 Предпросмотр'}
              </button>
            </div>
            {descPreview ? (
              <div className="w-full min-h-[6rem] p-2 border rounded bg-slate-50">
                {form.description?.trim() ? (
                  <Markdown text={form.description} />
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
