import { useRef, useState } from 'react'
import { tasksApi } from '../api/client'
import Modal from './Modal'

function formatDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
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
// Drag shorter than this is treated as a click (opens the editor).
const CLICK_SLOP = 8

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

  // Priority dot color: 1 Low (Grey), 2 Medium (Blue), 3 High (Red)
  const priorityDot = {
    1: 'bg-slate-400',
    2: 'bg-blue-500',
    3: 'bg-red-500',
  }[task.priority || 2]

  const moveTo = (targetName) => {
    if (targetName === 'Готово' && task.is_blocked) {
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
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)

  const swipeTarget = (dx) => {
    if (dx > SWIPE_THRESHOLD) return { dir: 'right', list: prevList, del: isFirst }
    if (dx < -SWIPE_THRESHOLD) return { dir: 'left', list: nextList, del: isLast }
    return null
  }

  const onPointerDown = (e) => {
    if (e.button && e.button !== 0) return
    dragRef.current = { x: e.clientX, y: e.clientY, axis: null }
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
      // Damp the drag near the edges where the gesture means "delete".
      const max = swipeTarget(dx) ? SWIPE_THRESHOLD + 24 : SWIPE_THRESHOLD + 90
      const limited = Math.max(-max, Math.min(max, dx))
      setDragX(limited)
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
    if (!t) return
    if (t.del) handleDelete()
    else if (t.list) moveTo(t.list.name)
  }

  const onPointerCancel = () => {
    dragRef.current = null
    setDragging(false)
    setDragX(0)
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

  // Swipe hint shown behind the card while dragging.
  const hint =
    dragX > SWIPE_THRESHOLD
      ? isFirst
        ? { text: 'Удалить', del: true }
        : prevList && { text: `«${prevList.name}»` }
      : dragX < -SWIPE_THRESHOLD
        ? isLast
          ? { text: 'Удалить', del: true }
          : nextList && { text: `«${nextList.name}»` }
        : null

  const overdue = task.deadline && new Date(task.deadline) < new Date()

  return (
    <div className={`relative bg-white rounded-md shadow-sm overflow-hidden ${task.cycle_dormant ? 'opacity-60' : ''}`}>
      {/* Swipe hint layer behind the card body */}
      {hint && (
        <div
          className={`absolute inset-0 flex items-center ${
            (dragX > 0 ? 'justify-start pl-4' : 'justify-end pr-4') +
            (hint.del ? ' bg-red-50' : ' bg-blue-50')
          }`}
        >
          <span className={`text-sm font-semibold ${hint.del ? 'text-red-500' : 'text-blue-600'}`}>
            {dragX > 0 ? '→ ' : '← '}
            {hint.text}
          </span>
        </div>
      )}

      {/* Card body: draggable horizontally; tap opens the editor */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={() => {
          // A horizontal drag must not open the editor.
          if (!dragging && Math.abs(dragX) < CLICK_SLOP) onEdit(task)
        }}
        style={{ touchAction: 'pan-y', ...(dragging ? { transform: `translateX(${dragX}px)` } : {}) }}
        className={`relative flex-1 min-w-0 py-2 px-2 bg-white ${dragging ? 'cursor-grabbing select-none' : 'cursor-pointer'}`}
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

        {/* Line 2: description, single line, italic allowed */}
        {task.description && (
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-1 break-words italic">
            {task.description}
          </p>
        )}

        {/* Line 3: start date (left) / deadline (right, red when overdue) */}
        <div className="flex items-center justify-between gap-2 mt-1.5 text-[11px] font-bold text-slate-600">
          <div className="truncate">{task.start_date && formatDate(task.start_date)}</div>
          <div className={`truncate ${overdue ? 'text-red-500' : ''}`}>
            {task.deadline && formatDate(task.deadline)}
          </div>
        </div>

        {/* Line 4: tags, centered, single line — only fully fitting tags are visible */}
        {(task.tags || []).length > 0 && (
          <div className="mt-1 overflow-hidden">
            <div className="flex justify-center gap-1 whitespace-nowrap">
              {(task.tags || []).map((t, i) => {
                const name = typeof t === 'string' ? t : (t.name || t)
                const tagData = tags.find((tag) => tag.name === name)
                const color = tagData ? tagData.color : '#64748b'
                return (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white shrink-0"
                    style={{ backgroundColor: color }}
                    title={name}
                  >
                    {name}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* Line 5: blocking tasks, centered, single line — only fully fitting are visible */}
        {(task.is_blocked || (task.blocked_by && task.blocked_by.length > 0)) && (
          <div className="mt-1 overflow-hidden">
            <div className="flex justify-center gap-1 whitespace-nowrap">
              {(task.blocked_by || []).map((bid) => {
                const bTask = allTasks.find((t) => t.id === bid)
                return (
                  <span
                    key={bid}
                    className="px-1 rounded bg-slate-100 border border-slate-300 text-[10px] text-slate-600 shrink-0"
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
              onClick={() => moveTo('Готово')}
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
