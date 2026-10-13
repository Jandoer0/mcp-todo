import { useRef, useState } from 'react'
import { tasksApi } from '../api/client'
import Modal from './Modal'

// "12 окт." when the year matches the current one, "12 окт. 2027" otherwise.
function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  const opts = { day: 'numeric', month: 'short' }
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('ru-RU', opts)
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

export default function TaskCard({ task, allTasks = [], lists = [], tags = [], onSetList, onEdit, onDelete }) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState([])
  // Lists are ordered by position; movement goes to the adjacent (neighbor) list
  // so a card never "jumps" over a column.
  const ordered = [...lists].sort((a, b) => a.position - b.position)
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

  const moveTo = (targetName) => {
    if (lists.find((l) => l.name === targetName)?.kind === 'done' && task.is_blocked) {
      alert('Сначала выполните блокирующие задачи')
      return
    }
    onSetList(task, targetName)
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
  const dragRef = useRef(null) // { x, y, axis } of the active gesture
  const suppressClickRef = useRef(false) // swallow the click right after a horizontal drag
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  // Hard cap on the drag offset (fits even long list names, truncated label).
  const dragLimit = MAX_DRAG

  const swipeTarget = (dx, limit = MAX_DRAG) => {
    // Swipe right = move FORWARD (to the next list); on the last list — delete.
    // Swipe left = move BACKWARD (to the previous list); on the first — delete.
    if (dx > SWIPE_THRESHOLD) return { dir: 'right', list: nextList, del: isLast }
    if (dx < -SWIPE_THRESHOLD) return { dir: 'left', list: prevList, del: isFirst }
    return null
  }

  const onPointerDown = (e) => {
    if (e.button && e.button !== 0) return
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
    if (t.del) handleDelete()
    else if (t.list) moveTo(t.list.name)
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
    if (!confirm(`Остановить цикл задачи «${task.title}»? Новые копии создаваться больше не будут.`)) return
    try {
      await tasksApi.cycleStop(task.id)
      onRefresh && onRefresh()
    } catch (e) {
      alert(e?.response?.data?.detail || 'Не удалось остановить цикл')
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
          if (!dragging && Math.abs(dragX) < CLICK_SLOP) onEdit(task)
        }}
        style={{ touchAction: 'pan-y', ...(dragging ? { transform: `translateX(${dragX}px)` } : {}) }}
        className={`relative bg-white rounded-md shadow-sm overflow-hidden py-2 px-2 ${dragging ? 'cursor-grabbing select-none' : 'cursor-pointer'}`}
      >
        {/* Line 1: title, bold, single line */}
        <div
          className="font-bold truncate text-sm text-slate-800 flex items-center gap-1.5"
          title={task.title}
        >
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${priorityDot}`}
            title={task.priority === 3 ? 'Высокий приоритет' : task.priority === 1 ? 'Низкий приоритет' : 'Средний приоритет'}
          />
          <span className="truncate">{task.title}</span>
          {task.cycle_dormant && (
            <span className="text-[10px] font-normal text-slate-400 shrink-0" title="Появится в основных списках ближе к дедлайну">
              (запланирована)
            </span>
          )}
        </div>

        {/* Line 3: start date (left) / deadline (right) as tag chips.
            The deadline chip turns red when the task is overdue. */}
        <div className="flex items-center justify-between gap-2 mt-1.5">
          <div className="min-w-0 truncate">
            <DateChip value={task.start_date} />
          </div>
          <div className="min-w-0 flex justify-end">
            <DateChip value={task.deadline} />
          </div>
        </div>

        {/* Line 4: tags then blocking tasks, one centered line. When the row
            overflows, each half is capped at 50% of the card width so a part
            of BOTH tags and blockers stays visible (tags show their tail near
            the center, blockers show their head). */}
        {(((task.tags || []).length > 0) ||
          (task.is_blocked || (task.blocked_by && task.blocked_by.length > 0))) && (
          <div className="mt-1 flex justify-center gap-1 overflow-hidden">
            <div className="flex gap-1 min-w-0 max-w-[50%] justify-end overflow-hidden whitespace-nowrap">
              {(task.tags || []).map((t, i) => {
                const name = typeof t === 'string' ? t : (t.name || t)
                const tagData = tags.find((tag) => tag.name === name)
                const color = tagData ? tagData.color : '#64748b'
                return (
                  <span
                    key={`t${i}`}
                    className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white shrink-0"
                    style={{ backgroundColor: color }}
                    title={name}
                  >
                    {name}
                  </span>
                )
              })}
            </div>
            <div className="flex gap-1 min-w-0 max-w-[50%] overflow-hidden whitespace-nowrap">
              {(task.blocked_by || []).map((bid) => {
                const bTask = allTasks.find((t) => t.id === bid)
                return (
                  <span
                    key={`b${bid}`}
                    className="px-1 rounded bg-slate-100 border border-slate-300 text-[10px] text-slate-600 shrink-0"
                    title={bTask ? bTask.title : bid}
                  >
                    {bTask ? bTask.title : bid}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* Cycle controls for cyclic tasks */}
        {task.is_cyclic && (
          <div
            className="flex flex-wrap justify-center items-center gap-1 mt-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => moveTo(doneListName)}
              disabled={task.is_blocked}
              title={task.is_blocked ? 'Сначала выполните блокирующие задачи' : 'Отметить выполненной и создать следующую итерацию'}
              className="px-2 py-0.5 rounded bg-green-600 text-white text-[10px] font-semibold hover:bg-green-700 disabled:opacity-40"
            >
              Выполнено
            </button>
            <button
              type="button"
              onClick={handleSkip}
              title="Сдвинуть срок на следующий цикл без записи в истории"
              className="px-2 py-0.5 rounded bg-blue-500 text-white text-[10px] font-semibold hover:bg-blue-600"
            >
              Пропустить
            </button>
            <button
              type="button"
              onClick={handleStop}
              title="Остановить цикл — новые копии создаваться не будут"
              className="px-2 py-0.5 rounded bg-slate-500 text-white text-[10px] font-semibold hover:bg-slate-600"
            >
              Остановить
            </button>
            <button
              type="button"
              onClick={openHistory}
              title="История выполненных итераций"
              className="px-2 py-0.5 rounded border border-slate-300 text-slate-500 text-[10px] hover:bg-slate-100"
            >
              История
            </button>
          </div>
        )}
      </div>

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title={`История: ${task.title}`}>
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
                </span>
                <span className="text-xs text-slate-400 shrink-0">
                  {new Date(h.logged_at).toLocaleString('ru-RU')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  )
}
