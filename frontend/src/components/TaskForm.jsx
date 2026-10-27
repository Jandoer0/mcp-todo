import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { tasksApi, currenciesApi } from '../api/client'
import TagInput from './TagInput'
import TaskLinkInput from './TaskLinkInput'
import Modal from './Modal'
import DateTimePicker from './DateTimePicker'
import { GravityEditor } from './editor/GravityEditor'
import { fmtInstant } from '../utils/datetime'
import { numberLocale } from '../utils/format'
import { MONTH_SHORT_KEYS } from '../utils/locale'

const LISTS_FALLBACK = ['Входящие', 'В планах', 'В работе', 'На проверке', 'Готово']

// Ключи приоритетов в словаре перевода (priorities.*).
const PRIORITY_KEYS = { 1: 'low', 2: 'medium', 3: 'high' }

// «2025-10-12» → «12 окт. 2025» / «Oct 12 2025». Плановые даты (start_date /
// deadline) читаются как есть — без сдвига по часовому поясу (utils/datetime.js).
function fmtLogDate(value, t) {
  if (!value) return '—'
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number)
  return `${d} ${t(`months.short.${MONTH_SHORT_KEYS[m - 1]}`)} ${y}`
}

// Строка истории по записи лога (field, old_value, new_value)
function describeChange(c, t) {
  const priorityLabel = (v) => t(`priorities.${PRIORITY_KEYS[Number(v)] || 'low'}`)
  if (c.field === 'completed_at') {
    return `${t('task.changeLogField.completed_at')}: ${fmtInstant(c.new_value)}`
  }
  if (c.field === 'description') return t('task.changeDescription')
  if (c.field === 'priority') {
    return t('task.changePriority', { old: priorityLabel(c.old_value), new: priorityLabel(c.new_value) })
  }
  if (c.field === 'amount') {
    const f = (v) => (v == null ? '—' : `${Number(v) > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(Number(v)).toLocaleString(numberLocale())}`)
    return t('task.changeAmount', { old: f(c.old_value), new: f(c.new_value) })
  }
  if (c.field === 'list') {
    return t('task.changeStatus', { old: c.old_value || '—', new: c.new_value || '—' })
  }
  const label = c.field === 'start_date' ? t('task.startDate') : t('task.endDate')
  return t('task.changeDate', {
    label,
    old: c.old_value ? fmtLogDate(c.old_value, t) : '—',
    new: c.new_value ? fmtLogDate(c.new_value, t) : '—',
  })
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
  const { t } = useTranslation()
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
  // markdown-строка из редактора (WYSIWYG хранит HTML, наружу отдаём markdown)
  const [editorMarkdown, setEditorMarkdown] = useState('')

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
      setEditorMarkdown(task.description || '')
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
      setEditorMarkdown('')
    }
  }, [open, task, defaultBoardId, initialList])

  if (!open) return null

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  // Переключение чекбокса GFM-задачи (старая механика предпросмотра): больше не нужна —
  // чекбоксы редактируются прямо в редакторе. Оставлена на случай старых дескрипшенов.
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
    // Описаниe — из редактора (markdown).
    if (!task || editorMarkdown !== (task.description || '')) payload.description = editorMarkdown || null
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
    <Modal open={open} onClose={onClose} title={task ? t('task.editTitle') : t('task.createTitle')}>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{t('task.title')}</label>
            <input
              type="text"
              id="task-title"
              name="title"
              placeholder={t('task.titlePlaceholder')}
              value={form.title}
              onChange={update('title')}
              className="w-full p-2 border rounded"
              required
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{t('task.startDate')}</label>
            <DateTimePicker
              id="task-start-date"
              name="start_date"
              value={form.start_date}
              onChange={update('start_date')}
              placeholder={t('task.notSet')}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{t('task.endDate')}</label>
            <DateTimePicker
              id="task-deadline"
              name="deadline"
              value={form.deadline}
              onChange={update('deadline')}
              placeholder={t('task.notSet')}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{t('task.priority')}</label>
            <select
              id="task-priority"
              name="priority"
              value={form.priority}
              onChange={update('priority')}
              className="w-full p-2 border rounded"
            >
              <option value={1}>{t('priorities.low')}</option>
              <option value={2}>{t('priorities.medium')}</option>
              <option value={3}>{t('priorities.high')}</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{t('task.status')}</label>
            <select
              id="task-list"
              name="list"
              value={form.list}
              onChange={update('list')}
              className="w-full p-2 border rounded"
            >
              {listOptions.map((l) => (
                <option key={l.name} value={l.name} disabled={l.kind === 'regular'}>
                  {l.name}{l.kind === 'regular' ? t('task.regularOnlyHint') : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{t('task.amountWeight')}</label>
            <div className="flex gap-2">
              {/* Доход/Расход: на мобильных — кнопка-знак (+/−), на десктопе — переключатель */}
              {amountCompact ? (
                <button
                  type="button"
                  onClick={() => setAmountType(amountType === 'income' ? 'expense' : 'income')}
                  title={amountType === 'income' ? t('task.incomeHint') : t('task.expenseHint')}
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
                    {t('task.income')}
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
                    {t('task.expense')}
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
                title={t('task.currency')}
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
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{t('task.description')}</label>
            <GravityEditor
              initialValue={form.description || ''}
              onChange={(markdown) => setEditorMarkdown(markdown)}
              minHeight={150}
              maxHeight={450}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{t('task.tags')}</label>
            <TagInput
              value={selectedTags}
              availableTags={tags}
              takenColors={listOptions.map((l) => l.color)}
              onChange={setSelectedTags}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{t('task.blockersLabel2')}</label>
            <TaskLinkInput
              value={selectedBlockers}
              tasks={tasks}
              excludeId={task?.id}
              onChange={setSelectedBlockers}
            />
            <p className="text-xs text-gray-500 mt-1">
              {t('task.blockersHint')}
            </p>
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{t('task.board')}</label>
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
              {t('task.moveHint')}
            </p>
          </div>
      <div className="md:col-span-2 flex justify-between items-center mt-4">
        <button
          type="button"
          onClick={() => {
            if (task && confirm(t('task.deleteConfirm', { title: task.title }))) {
              onSubmit({ _action: 'delete' })
            }
          }}
          disabled={!task}
          className="px-4 py-2 text-red-500 hover:text-red-600 hover:bg-red-50 rounded font-medium transition-colors"
        >
          {t('common.delete')}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="bg-green-600 text-white px-5 py-2 rounded hover:bg-green-700 font-medium"
          >
            {task ? t('common.save') : t('task.createTitle')}
          </button>
        </div>
      </div>
      {/* История изменений дат/приоритета/описания (хронологическая) — на всю ширину формы */}
      {task && (
        <div className="md:col-span-2 mt-4 pt-3 border-t border-slate-200">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
            {t('task.changeLog')}
          </h4>
          {changes.length === 0 ? (
            <p className="text-xs text-slate-400">{t('task.noChangesYet')}</p>
          ) : (
            <div className="max-h-44 overflow-y-auto overscroll-contain rounded border border-slate-100 divide-y divide-slate-100">
              {/* свежие записи сверху; ползунок прокрутки — в верхнем положении */}
              {[...changes].reverse().map((c) => (
                <div key={c.id} className="px-2 py-1.5 text-xs text-slate-600 flex justify-between gap-2">
                  <span>{describeChange(c, t)}</span>
                  <span className="text-slate-400 shrink-0">{fmtInstant(c.changed_at)}</span>
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
