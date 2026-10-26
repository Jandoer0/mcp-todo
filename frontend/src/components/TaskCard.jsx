import { useRef, useState, useLayoutEffect, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { tasksApi } from '../api/client'
import Modal from './Modal'
import { compactAmount, currencySymbol, formatAmount } from '../utils/format'
import { toWallClock } from '../utils/datetime'

// «12 окт.» / «Oct 12» — карточка даты. Месяц — из словаря (months.short),
// формат числовой части фиксированный. Плановые даты — календарный день,
// сдвиг по поясу не применяется (см. utils/datetime.js).
function formatDate(value) {
  if (!value) return ''
  const p = dateParts(value)
  if (!p) return ''
  const month = i18n.t(`months.short.${MONTH_SHORT_KEYS[p.m - 1]}`)
  return p.y !== new Date().getFullYear() ? `${p.d} ${month} ${p.y}` : `${p.d} ${month}`
}

// Date rendered as a tag-like chip: gray when the day hasn't come yet,
// orange when it is today, red when the date has passed.
function DateChip({ value }) {
  if (!value) return null
  const day = (v) => {
    const d = new Date(v)
    d.setHours(0, 0, 0, 0)
    return d
  }
  const diff = day(value).getTime() - day(new Date()).getTime()
  const bg = diff > 0 ? 'bg-slate-400' : diff === 0 ? 'bg-orange-500' : 'bg-red-500'
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold text-white shrink-0 ${bg}`}
    >
      {formatDate(value)}
    </span>
  )
}

// Progress bar for blocking tasks: fills as blockers move to a list with
// the "done" property (kind='done'). Hover shows a tooltip with the blocker
// list — rendered via portal because the card has overflow-hidden.
function BlockersProgress({ blockers }) {
  const { t } = useTranslation()
  const [pos, setPos] = useState(null) // { left, top, bottom } viewport coords
  const [above, setAbove] = useState(true)
  const tipRef = useRef(null)
  const total = blockers.length
  const done = blockers.filter((b) => b.isDone).length
  const pct = total ? Math.round((done / total) * 100) : 0

  // Flip the tooltip below the bar when there is not enough room above.
  useLayoutEffect(() => {
    if (pos && above && tipRef.current && pos.top - tipRef.current.offsetHeight < 4) {
      setAbove(false)
    }
  }, [pos, above])

  const show = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 268)), top: r.top, bottom: r.bottom })
    setAbove(true)
  }

  return (
    <div
      className="flex-1 min-w-0 py-1 -my-1 cursor-help"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={t('task.blockersLabel', { done, total })}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
    >
      <div className="flex items-center gap-1.5">
        <div className="flex-1 min-w-0 h-1.5 rounded-full bg-slate-300/70 overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* Amount of blocking tasks: done/total */}
        <span className="text-[10px] leading-none text-slate-500 shrink-0 tabular-nums">
          {done}/{total}
        </span>
      </div>
      {pos && createPortal(
        <div
          ref={tipRef}
          className="fixed z-[60] w-max max-w-[260px] px-2 py-1.5 rounded-lg bg-slate-800 text-white text-[11px] leading-snug shadow-lg pointer-events-none"
          style={
            above
              ? { left: pos.left, bottom: window.innerHeight - pos.top + 8 }
              : { left: pos.left, top: pos.bottom + 8 }
          }
        >
          <div className="font-semibold mb-1">{t('task.blockersTitle', { done, total })}</div>
          <ul>
            {blockers.map((b) => (
              <li key={b.id} className="flex items-center gap-1.5">
                <span className={b.isDone ? 'text-green-400' : 'text-slate-400'}>{b.isDone ? '✓' : '○'}</span>
                <span className={b.isDone ? 'line-through opacity-70' : ''}>{b.title}</span>
              </li>
            ))}
          </ul>
        </div>,
        document.body
      )}
    </div>
  )
}

function ArrowDown() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function ArrowUp() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
    </svg>
  )
}

// Swipe thresholds: card must be dragged this far (px) to fire the action.
const SWIPE_THRESHOLD = 72
// Hard cap on the drag offset (fits even long list names, truncated label).
const MAX_DRAG = 113
// Drag shorter than this is treated as a click (opens the editor).
const CLICK_SLOP = 8

function Trash() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

export default function TaskCard({ task, allTasks = [], lists = [], tags = [], currencies = [], onSetList, onEdit, onEditCyclic, onDelete, onRefresh }) {
  const { t } = useTranslation()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState([])
  // Меню ⋯ на панели цикла (История / Остановить): рендерится порталом,
  // потому что карточка overflow-hidden — обычный dropdown был бы обрезан.
  const [menuPos, setMenuPos] = useState(null) // { left, top } координаты вьюпорта
  const menuRef = useRef(null)
  const menuBtnRef = useRef(null)

  // Swipe right/left moves the card to a NEIGHBOURING list — cyclic tasks
  // are pinned to the system «Регулярные» list and must not be draggable.
  const isRegular = task.is_cyclic || task.list === 'Регулярные'
  const ordered = isRegular ? [] : [...lists].sort((a, b) => a.position - b.position)
  const idx = ordered.findIndex((l) => l.name === task.list)
  const nextList = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null
  const prevList = idx > 0 ? ordered[idx - 1] : null
  const isFirst = idx === 0
  const isLast = idx === ordered.length - 1
  // Tasks in "Готово"/"Архив" (kind='done') look faded on the board.
  const isDone = idx >= 0 && ordered[idx].kind === 'done'

  // Priority dot color: 1 Low (Grey), 2 Medium (Blue), 3 High (Red)
  const priorityDot = {
    1: 'bg-slate-400',
    2: 'bg-blue-500',
    3: 'bg-red-500',
  }[task.priority || 2]

  // The user's "done" list is any list with kind='done' (prefer the first
  // that is not the archive). All lists are user-editable now.
  const doneListName =
    (lists.find((l) => l.kind === 'done' && l.name !== 'Архив') || lists.find((l) => l.kind === 'done') || {})
      .name || 'Готово'

  // Blockers with titles and their "done" state (their list has kind='done')
  // — drives the progress bar on the card.
  const blockers = (task.blocked_by || []).map((id) => {
    const bt = allTasks.find((t) => t.id === id)
    const bList = bt ? lists.find((l) => l.name === bt.list) : null
    return { id, title: bt ? bt.title : `#${id}`, isDone: !!bList && bList.kind === 'done' }
  })

  const moveTo = (targetName) => {
    // Жёсткая связь «циклическая ⇔ Регулярные»: циклическую нельзя вытащить
    // из системного списка, обычную нельзя перетащить в «Регулярные».
    if (task.is_cyclic) {
      alert(t('task.cyclicOnlyInRegular'))
      return
    }
    if (lists.find((l) => l.name === targetName)?.kind === 'regular') {
      alert(t('task.regularOnlyCyclic'))
      return
    }
    if (lists.find((l) => l.name === targetName)?.kind === 'done' && task.is_blocked) {
      alert(t('task.blockedByOthers'))
      return
    }
    // §5.4: при завершении циклической через done-список передаём
    // локальную дату клиента вместо utcnow() сервера (иначе для не-UTC
    // таймзон фактическая дата попадает в чужой день).
    // actual_date — плановая дата (календарный день), поэтому строка
    // БЕЗ пояса, в местном времени — см. utils/datetime.js.
    const extra =
      task.is_cyclic && lists.find((l) => l.name === targetName)?.kind === 'done'
        ? { actual_date: toWallClock(new Date()) }
        : {}
    onSetList(task, targetName, extra)
  }

  const handleDelete = () => {
    const msg = task.is_cyclic
      ? `Удалить циклическую задачу «${task.title}» и ВСЮ её историю?`
      : `Удалить задачу «${task.title}»?`
    if (confirm(msg)) onDelete(task)
  }

  // ---- Swipe mechanics (replaces the side radio buttons) ----
  // Swipe right → move to the PREVIOUS (upper) list; in the first list — delete.
  // Swipe left  → move to the NEXT (lower) list; in the last list — delete.
  // СТАРАЯ механика (свайп) — только для мобильных (pointer: coarse):
  // на десктопе перенос карточек выполняет нативный Drag&Drop (Board.jsx),
  // и pointer-жест не должен перехватывать горизонтальное движение мыши.
  const [canSwipe] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches,
  )
  const dragRef = useRef(null) // { x, y, axis } of the active gesture
  const suppressClickRef = useRef(false) // swallow the click right after a horizontal drag
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  // Hard cap on the drag offset (fits even long list names, truncated label).
  const dragLimit = MAX_DRAG

  const swipeTarget = (dx, limit = MAX_DRAG) => {
    // Циклические задачи не перетаскиваются (жёсткая связь со списком).
    if (isRegular) return null
    // Swipe right = move FORWARD (to the next list); on the last list — delete.
    // Swipe left = move BACKWARD (to the previous list); on the first — delete.
    if (dx > SWIPE_THRESHOLD) return { dir: 'right', list: nextList, del: isLast }
    if (dx < -SWIPE_THRESHOLD) return { dir: 'left', list: prevList, del: isFirst }
    return null
  }

  const onPointerDown = (e) => {
    // На десктопе жест не стартует: мышь управляет DnD Board.
    if (!canSwipe || e.pointerType === 'mouse') return
    if (e.button && e.button !== 0) return
    // Жёсткая связь «циклическая ⇔ Регулярные»: карточку нельзя ни свайпнуть
    // в другой список, ни свайпнуть в удаление — жест просто не стартует.
    if (isRegular) return
    // Presses on interactive children (cycle buttons, blockers) must not start
    // a drag: setPointerCapture would retarget pointerup/click to the card and
    // the button's own onClick would never fire.
    if (e.target.closest('button, a, input, textarea, select, label')) return
    dragRef.current = { x: e.clientX, y: e.clientY, axis: null }
    // Capture the pointer so pointerup is always delivered to the card,
    // even if the cursor leaves it mid-drag (prevents "stuck" dragging).
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
  }

  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
      // Lock the axis once: horizontal → swipe, vertical → let the page scroll.
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
      if (d.axis === 'h') setDragging(true)
    }
    if (d.axis === 'h') {
      e.preventDefault()
      setDragX(Math.max(-dragLimit, Math.min(dragLimit, dx)))
    }
  }

  const onPointerUp = (e) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d || d.axis !== 'h') return
    const dx = e.clientX - d.x
    const t = swipeTarget(dx)
    setDragging(false)
    setDragX(0)
    // Suppress the synthetic click that follows the pointer: on desktop a
    // mouse swipe must not open the editor right afterwards.
    suppressClickRef.current = true
    // t === null — свайп короче порога: просто отпускаем без действия.
    if (t?.del) handleDelete()
    else if (t?.list) moveTo(t.list.name)
  }

  const onPointerCancel = () => {
    dragRef.current = null
    setDragging(false)
    setDragX(0)
    suppressClickRef.current = false
  }

  const handleSkip = async () => {
    try {
      await tasksApi.cycleSkip(task.id)
      onRefresh && onRefresh()
    } catch (e) {
      alert(e?.response?.data?.detail || 'Не удалось пропустить цикл')
    }
  }

  const handleStop = async () => {
    if (!confirm(t('task.cycleStopConfirm', { title: task.title }))) return
    try {
      await tasksApi.cycleStop(task.id)
      onRefresh && onRefresh()
    } catch (e) {
      alert(e?.response?.data?.detail || 'Не удалось остановить цикл')
    }
  }

  // «План vs Факт»: диалог финансового подтверждения завершения итерации.
  const [completeOpen, setCompleteOpen] = useState(false)
  const [completeDate, setCompleteDate] = useState('')
  const [completeAmount, setCompleteAmount] = useState('')
  // Направление факта: доход (+) / расход (−), по умолчанию — как в плане
  const [completeType, setCompleteType] = useState('expense')
  const [completeError, setCompleteError] = useState('')

  const openComplete = () => {
    const now = new Date()
    const p = (n) => String(n).padStart(2, '0')
    // Дата выполнения: по умолчанию — текущая дата.
    setCompleteDate(`${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`)
    // Фактическая сумма: по умолчанию — плановая (модуль).
    setCompleteAmount(task.amount ? String(Math.abs(task.amount)) : '')
    setCompleteType((Number(task.amount) || 0) >= 0 ? 'income' : 'expense')
    setCompleteError('')
    setCompleteOpen(true)
  }

  const submitComplete = async () => {
    const rawAmount = String(completeAmount).replace(',', '.').trim()
    const v = rawAmount === '' ? 0 : parseFloat(rawAmount)
    if (isNaN(v) || v < 0) {
      setCompleteError('Введите сумму не меньше нуля')
      return
    }
    if (!completeDate) {
      setCompleteError('Укажите дату выполнения')
      return
    }
    try {
      await tasksApi.cycleComplete(task.id, {
        actual_date: `${completeDate}T12:00:00`,
        actual_amount: v === 0 ? 0 : (completeType === 'income' ? v : -v),
      })
      setCompleteOpen(false)
      onRefresh && onRefresh()
    } catch (e) {
      setCompleteError(e?.response?.data?.detail || 'Не удалось завершить итерацию')
    }
  }

  const openHistory = async () => {
    try {
      const res = await tasksApi.cycleHistory(task.id)
      setHistory(res.data)
    } catch {
      setHistory([])
    }
    setHistoryOpen(true)
  }

  // ---- Меню ⋯ (История / Остановить цикл) ----
  const CYCLE_MENU_W = 176
  const toggleCycleMenu = () => {
    if (menuPos) {
      setMenuPos(null)
      return
    }
    const r = menuBtnRef.current?.getBoundingClientRect()
    if (!r) return
    setMenuPos({
      left: Math.max(8, Math.min(r.right - CYCLE_MENU_W, window.innerWidth - 8 - CYCLE_MENU_W)),
      top: Math.min(r.bottom + 4, window.innerHeight - 96),
    })
  }
  const closeCycleMenu = () => setMenuPos(null)
  // Клик/тап вне меню (и не по самой кнопке ⋯) закрывает его.
  useEffect(() => {
    if (!menuPos) return
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target)) return
      if (menuBtnRef.current?.contains(e.target)) return
      setMenuPos(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [menuPos])

  // ---- Корректировка истории итераций («План vs Факт» задним числом) ----
  const [editLog, setEditLog] = useState(null) // запись истории в редакторе
  const [editDate, setEditDate] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editType, setEditType] = useState('expense')
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const openLogEdit = (h) => {
    const d = h.actual_date ? new Date(h.actual_date) : new Date()
    const p = (n) => String(n).padStart(2, '0')
    setEditDate(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)
    const v = Math.abs(Number(h.actual_amount) || 0)
    setEditAmount(v ? String(v) : '')
    setEditType((Number(h.actual_amount) || 0) >= 0 ? 'income' : 'expense')
    setEditError('')
    setEditLog(h)
  }

  const submitLogEdit = async () => {
    const rawAmount = String(editAmount).replace(',', '.').trim()
    const v = rawAmount === '' ? 0 : parseFloat(rawAmount)
    if (isNaN(v) || v < 0) {
      setEditError('Введите сумму не меньше нуля')
      return
    }
    if (!editDate) {
      setEditError('Укажите дату выполнения')
      return
    }
    setEditSaving(true)
    try {
      await tasksApi.cycleLogUpdate(task.id, editLog.id, {
        actual_date: `${editDate}T12:00:00`,
        actual_amount: v === 0 ? 0 : (editType === 'income' ? v : -v),
      })
      setEditLog(null)
      // Обновить открытую историю, чтобы правка была видна сразу.
      try {
        const res = await tasksApi.cycleHistory(task.id)
        setHistory(res.data)
      } catch {}
      onRefresh && onRefresh()
    } catch (e) {
      setEditError(e?.response?.data?.detail || 'Не удалось сохранить правку')
    } finally {
      setEditSaving(false)
    }
  }

  // Swipe hint shown behind the card while dragging. It appears IMMEDIATELY
  // once the horizontal drag starts (not after the threshold) and behaves like
  // a STATIC area under the card: the target-list label stays anchored to the
  // outer edge of the revealed strip while the card slides off it.
  const hint =
    dragX > 0
      ? isLast
        ? { text: '', del: true, committed: dragX > SWIPE_THRESHOLD }
        : nextList && { text: nextList.name, color: nextList.color, committed: dragX > SWIPE_THRESHOLD }
      : dragX < 0
        ? isFirst
          ? { text: '', del: true, committed: Math.abs(dragX) > SWIPE_THRESHOLD }
          : prevList && { text: prevList.name, color: prevList.color, committed: Math.abs(dragX) > SWIPE_THRESHOLD }
        : null

  // Measure after `hint` is computed (declared above).

  const overdue = task.deadline && new Date(task.deadline) < new Date()

  return (
    <div className={`relative ${task.cycle_dormant || isDone ? 'opacity-60' : ''}`}>
      {/* Static underlay ON THE DASHBOARD BACKGROUND, revealed by the sliding
          card: a rounded tinted area with the target-list label anchored to
          the outer edge. The label text flashes (white, pulsing) once the
          swipe passes the action threshold. */}
      {Math.abs(dragX) > 0 && hint && (
        <div
          className="absolute inset-y-0 flex items-center rounded-md"
          style={{
            width: Math.min(Math.abs(dragX) + 8, dragLimit + 8),
            [dragX > 0 ? 'left' : 'right']: 0,
            backgroundColor: hint.del ? '#f8717133' : `${hint.color}33`,
          }}
        >
          <div
            className={`absolute inset-y-0 flex items-center ${
              dragX > 0 ? 'left-0 pl-3' : 'right-0 pr-3'
            }`}
          >
            {hint.del ? (
              <span className="text-red-400">
                <Trash />
              </span>
            ) : (
              <span
                className={`text-sm font-semibold whitespace-nowrap truncate ${
                  hint.committed ? 'text-white animate-pulse' : ''
                }`}
                style={hint.committed ? {} : { color: hint.color }}
              >
                {hint.text}
              </span>
            )
            }
          </div>
        </div>
      )}

      {/* Card body: the white rounded sheet itself slides off the underlay;
          tap opens the editor */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={() => {
          // A horizontal drag (or the click right after it) must not open the editor.
          if (suppressClickRef.current) {
            suppressClickRef.current = false
            return
          }
          if (!dragging && Math.abs(dragX) < CLICK_SLOP) (task.is_cyclic ? (onEditCyclic || onEdit)(task) : onEdit(task))
        }}
        style={{ touchAction: 'pan-y', ...(dragging ? { transform: `translateX(${dragX}px)` } : {}) }}
        className={`relative bg-card rounded-md shadow-sm overflow-hidden py-2 px-2 ${dragging ? 'cursor-grabbing select-none' : 'cursor-pointer'}`}
      >
        {/* Строка 1: только название задачи (до 2 строк, ТЗv2 §1.7) — бейджи
            суммы и периода больше не конкурируют с ним за ширину. */}
        <div
          className="font-bold text-sm text-slate-800 flex items-start gap-1.5"
          title={task.title}
        >
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${priorityDot}`}
            title={task.priority === 3 ? 'Высокий приоритет' : task.priority === 1 ? 'Низкий приоритет' : 'Средний приоритет'}
          />
          <span className="line-clamp-2 break-words min-w-0">{task.title}</span>
        </div>

        {/* Строка 2: «маркер · сумма · дата» — слева дата начала (у циклической
            вместо неё бейдж периода ↻), по центру сумма со знаком и символом
            валюты задачи (§3), справа дедлайн-чип (краснеет при просрочке). */}
        <div className="flex items-center justify-between gap-2 mt-1.5">
          <div className="min-w-0 shrink-0">
            {task.is_cyclic ? (
              <span
                className="inline-block px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 text-[10px] font-semibold whitespace-nowrap"
                title="Циклическая задача"
              >
                ↻ {({ daily: 'ежедневно', weekly: 'еженедельно', monthly: 'ежемесячно', yearly: 'ежегодно' })[task.cycle_period] || 'цикл'}
              </span>
            ) : (
              <DateChip value={task.start_date} />
            )}
          </div>
          <div className="flex-1 min-w-0 flex justify-center">
            {(Number(task.amount) || 0) !== 0 && (
              <span
                className={`text-[11px] font-bold whitespace-nowrap ${
                  Number(task.amount) > 0 ? 'text-amber-400' : 'text-red-500'
                }`}
                title={`Сумма: ${formatAmount(task.amount)} ${currencySymbol(task, currencies)}`}
              >
                {Number(task.amount) > 0 ? '+' : '−'}
                {compactAmount(Number(task.amount))} {currencySymbol(task, currencies)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex justify-end shrink-0">
            <DateChip value={task.deadline} />
          </div>
        </div>

        {/* Строка 3: теги — на всю ширину карточки (flex-wrap), они больше
            не делят строку со шкалой блокеров и не скрываются при переполнении. */}
        {(task.tags || []).length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {(task.tags || []).map((t, i) => {
              const name = typeof t === 'string' ? t : (t.name || t)
              const tagData = tags.find((tag) => tag.name === name)
              const color = tagData ? tagData.color : '#64748b'
              return (
                <span
                  key={`t${i}`}
                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white shrink-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
                  style={{ backgroundColor: color }}
                  title={name}
                >
                  {name}
                </span>
              )
            })}
          </div>
        )}

        {/* Строка 4: блокеры — своя строка с подписью; шкала занимает всю
            доступную ширину (наведение показывает список блокеров). */}
        {blockers.length > 0 && (
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-slate-400 shrink-0">Блокеры</span>
            <BlockersProgress blockers={blockers} />
          </div>
        )}

        {/* Панель цикла: главные действия «Выполнить» и «Пропустить» + меню ⋯
            с второстепенными (История, Остановить) — компактно, в один ряд. */}
        {task.is_cyclic && (
          <div
            className="flex items-center gap-1 mt-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={openComplete}
              disabled={task.is_blocked}
              title={task.is_blocked ? 'Сначала выполните блокирующие задачи' : 'Отметить выполненной и создать следующую итерацию'}
              className="px-2 py-0.5 rounded bg-green-600 text-white text-[10px] font-semibold hover:bg-green-700 disabled:opacity-40"
            >
              ✓ Выполнить
            </button>
            <button
              type="button"
              onClick={handleSkip}
              title="Сдвинуть срок на следующий цикл без записи в истории"
              className="px-2 py-0.5 rounded border border-green-600 text-green-600 text-[10px] font-semibold hover:bg-green-50"
            >
              → Пропустить
            </button>
            <button
              ref={menuBtnRef}
              type="button"
              onClick={toggleCycleMenu}
              title="Ещё действия: история итераций, остановка цикла"
              className="ml-auto w-6 h-6 rounded border border-slate-300 text-slate-500 text-sm leading-none hover:bg-slate-100 flex items-center justify-center"
            >
              ⋯
            </button>
          </div>
        )}

        {/* Меню ⋯ — портал на body: карточка overflow-hidden, обычный
            dropdown был бы обрезан её границами. */}
        {menuPos && createPortal(
          <div
            ref={menuRef}
            className="fixed z-[70] w-44 py-1 rounded-lg bg-white shadow-lg border border-slate-100"
            style={{ left: menuPos.left, top: menuPos.top }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              onClick={() => { closeCycleMenu(); openHistory() }}
            >
              {t('task.cycleHistoryButton')}
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm text-red-500 hover:bg-red-50"
              title="Новые копии создаваться больше не будут"
              onClick={() => { closeCycleMenu(); handleStop() }}
            >
              {t('task.cycleStopButton')}
            </button>
          </div>,
          document.body
        )}
      </div>

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title={t('task.cycleHistoryModalTitle', { title: task.title })}>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">Записей пока нет — история появляется после выполнения или остановки цикла.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 text-sm border-b border-slate-100 pb-2">
                <span className="truncate min-w-0">
                  <span
                    className={`inline-block w-2 h-2 rounded-full mr-2 ${
                      h.action === 'completed' ? 'bg-green-500' : 'bg-slate-400'
                    }`}
                  />
                  {h.task_title}
                  <span className="text-slate-400 ml-2">
                    {h.action === 'completed' ? 'выполнена' : 'цикл остановлен'}
                  </span>
                  {h.action === 'completed' && h.actual_amount != null && (
                    <span className="ml-2 text-xs tabular-nums font-semibold">
                      факт:{' '}
                      <span className={h.actual_amount < 0 ? 'text-red-500' : 'text-green-600'}>
                        {h.actual_amount > 0 ? '+' : ''}
                        {Math.abs(h.actual_amount).toLocaleString('ru-RU')}
                      </span>
                      {h.planned_amount != null && Number(h.planned_amount) !== Number(h.actual_amount) && (
                        <span className="text-slate-400 font-normal">
                          {' '}(план: {h.planned_amount > 0 ? '+' : ''}
                          {Math.abs(h.planned_amount).toLocaleString('ru-RU')})
                        </span>
                      )}
                    </span>
                  )}
                  {h.action === 'completed' && h.actual_date && (
                    <span className="ml-2 text-xs text-slate-400">
                      {new Date(h.actual_date).toLocaleDateString('ru-RU')}
                    </span>
                  )}
                </span>
                <span className="text-xs text-slate-400 shrink-0">
                  {new Date(h.logged_at).toLocaleString('ru-RU')}
                </span>
                {h.action === 'completed' && (
                  <button
                    type="button"
                    onClick={() => openLogEdit(h)}
                    title="Корректировать факт этой итерации"
                    className="px-2 py-0.5 rounded border border-slate-300 text-slate-500 text-[10px] hover:bg-slate-100"
                  >
                    Корректировать
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Корректировка «План vs Факт» для отдельной итерации */}
        {editLog && (
          <div className="mt-4 pt-3 border-t border-slate-100">
            <p className="text-sm font-semibold text-slate-700 mb-2">
              Корректировка: {editLog.task_title}
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                  Фактическая дата
                </label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full p-2 border rounded"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                  Фактическая сумма
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    className="w-full p-2 border rounded"
                    placeholder="Сумма платежа"
                  />
                  <div className="flex rounded overflow-hidden border border-slate-200 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditType('income')}
                      className={`px-3 text-sm font-medium ${
                        editType === 'income' ? 'bg-blue-500 text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      + доход
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditType('expense')}
                      className={`px-3 text-sm font-medium ${
                        editType === 'expense' ? 'bg-red-500 text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      − расход
                    </button>
                  </div>
                </div>
                {editLog.planned_amount && (
                  <p className="mt-1 text-xs text-slate-400">
                    По плану: {editLog.planned_amount > 0 ? '+' : '−'}{' '}{Math.abs(editLog.planned_amount).toLocaleString('ru-RU')}
                  </p>
                )}
              </div>
              {editError && <p className="text-sm text-red-500">{editError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditLog(null)}
                  className="px-3 py-2 rounded border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  disabled={editSaving}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={submitLogEdit}
                  disabled={editSaving}
                  className="px-3 py-2 rounded bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
                >
                  {editSaving ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* «План vs Факт»: подтверждение завершения циклической итерации */}
      <Modal open={completeOpen} onClose={() => setCompleteOpen(false)} dismissible={false} title={`Выполнить: ${task.title}`}>
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Подтвердите фактический платёж — он попадёт в историю итераций и на график (ретроспектива).
          </p>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Дата выполнения</label>
            <input
              type="date"
              value={completeDate}
              onChange={(e) => setCompleteDate(e.target.value)}
              className="w-full p-2 border rounded"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Фактическая сумма</label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={completeAmount}
                onChange={(e) => setCompleteAmount(e.target.value)}
                className="w-full p-2 border rounded"
                placeholder="Не указана (0)"
              />
              <div className="flex rounded overflow-hidden border border-slate-200 shrink-0">
                <button
                  type="button"
                  onClick={() => setCompleteType('income')}
                  className={`px-3 text-sm font-medium ${completeType === 'income' ? 'bg-blue-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  + доход
                </button>
                <button
                  type="button"
                  onClick={() => setCompleteType('expense')}
                  className={`px-3 text-sm font-medium ${completeType === 'expense' ? 'bg-red-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  − расход
                </button>
              </div>
            </div>
            {task.amount ? (
              <p className="mt-1 text-xs text-slate-400">
                По плану: {task.amount > 0 ? '+' : '−'}{Math.abs(task.amount).toLocaleString('ru-RU')}
              </p>
            ) : null}
          </div>
          {completeError && <p className="text-sm text-red-500">{completeError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setCompleteOpen(false)}
              className="px-3 py-2 rounded border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={submitComplete}
              className="px-3 py-2 rounded bg-green-600 text-white text-sm font-semibold hover:bg-green-700"
            >
              Подтвердить
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
