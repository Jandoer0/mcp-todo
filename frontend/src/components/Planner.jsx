import { useEffect, useMemo, useState } from 'react'
import { boardsApi, listsApi, tagsApi, tasksApi } from '../api/client'

const pad = (n) => String(n).padStart(2, '0')
const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const parseDate = (value) => (value ? String(value).slice(0, 10) : '')
const monthTitle = (date) => date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function shiftMonth(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function CalendarMonth({ month, selected, activity, onSelect }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < offset; i += 1) cells.push(null)
  for (let day = 1; day <= count; day += 1) cells.push(new Date(month.getFullYear(), month.getMonth(), day))
  while (cells.length % 7) cells.push(null)

  return (
    <section className="mb-6">
      <h3 className="mb-2 text-center text-sm font-bold capitalize text-slate-700">{monthTitle(month)}</h3>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-400">
        {weekDays.map((day) => <span key={day} className="py-1 font-semibold">{day}</span>)}
        {cells.map((date, index) => {
          if (!date) return <span key={`empty-${index}`} />
          const key = keyOf(date)
          const active = key === selected
          const today = key === keyOf(new Date())
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className={`relative flex h-9 flex-col items-center justify-center rounded-lg text-xs transition-colors ${active ? 'bg-green-600 font-bold text-white shadow' : 'text-slate-700 hover:bg-green-50'} ${today && !active ? 'ring-1 ring-green-500' : ''}`}
            >
              <span>{date.getDate()}</span>
              {activity.has(key) && <span className={`absolute bottom-1 h-1 w-1 rounded-full ${active ? 'bg-white' : 'bg-green-500'}`} />}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function BoardGroup({ board, tasks, allTasks, lists, tags = [], onEdit }) {
  const listByName = new Map(lists.map((list) => [list.name, list]))
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <h3 className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700">{board.name}</h3>
      <div className="divide-y divide-slate-100">
        {tasks.map((task) => {
          const blockers = (task.blocked_by || []).map((id) => allTasks.find((item) => item.id === id)).filter(Boolean)
          const done = blockers.filter((item) => listByName.get(item.list)?.kind === 'done').length
          const percent = blockers.length ? Math.round((done / blockers.length) * 100) : 0
          return (
            <button key={task.id} type="button" onClick={() => onEdit(task, board)} className="block w-full px-4 py-3 text-left transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-green-500">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${task.priority === 3 ? 'bg-red-500' : task.priority === 2 ? 'bg-blue-500' : 'bg-slate-400'}`}
                  title={task.priority === 3 ? 'Высокий приоритет' : task.priority === 2 ? 'Средний приоритет' : 'Низкий приоритет'}
                  aria-label={task.priority === 3 ? 'Высокий приоритет' : task.priority === 2 ? 'Средний приоритет' : 'Низкий приоритет'}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">{task.title}</span>
                {(task.tags || []).length > 0 && <div className="ml-auto flex min-w-0 shrink-0 max-w-[48%] items-center justify-end gap-1 overflow-hidden">{task.tags.map((tag, index) => { const name = typeof tag === 'string' ? tag : tag.name; return <span key={`${name}-${index}`} className="max-w-24 truncate rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: (typeof tag === 'object' && tag.color) || tags.find((item) => item.name === name)?.color || '#64748b' }} title={name}>{name}</span> })}</div>}
                <span className="shrink-0 text-xs tabular-nums text-slate-400">{task.deadline ? new Date(task.deadline).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : 'без даты'}</span>
              </div>
              {blockers.length > 0 && <div className="mt-2 flex items-center gap-2"><span className="shrink-0 text-[10px] font-semibold text-slate-400">Блокеры</span><div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${percent}%` }} /></div><span className="shrink-0 text-[10px] tabular-nums text-slate-500">{done}/{blockers.length}</span></div>}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function GroupedFeed({ title, tasksByBoard, empty, onEdit, tone = 'slate' }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className={`text-base font-extrabold ${tone === 'red' ? 'text-red-100' : tone === 'amber' ? 'text-amber-100' : 'text-white'}`}>{title}</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs ${tone === 'red' ? 'bg-red-200 text-red-800' : tone === 'amber' ? 'bg-amber-200 text-amber-800' : 'bg-white/20 text-white'}`}>{tasksByBoard.reduce((sum, item) => sum + item.tasks.length, 0)}</span>
      </div>
      {tasksByBoard.length ? <div className="space-y-3">{tasksByBoard.map((item) => <BoardGroup key={item.board.id} {...item} onEdit={onEdit} />)}</div> : <p className="rounded-xl border border-dashed border-slate-200 bg-white/70 px-4 py-6 text-center text-sm text-slate-400">{empty}</p>}
    </section>
  )
}

export default function Planner({ open, onClose, onEdit }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selected, setSelected] = useState(() => keyOf(new Date()))
  const [boards, setBoards] = useState([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    boardsApi.list().then(async (boardResponse) => {
      const loaded = boardResponse.data || []
      const data = await Promise.all(loaded.map(async (board) => {
        const [tasksResponse, listsResponse] = await Promise.all([tasksApi.list(board.id), listsApi.list(board.id)])
        const progressNames = new Set((listsResponse.data || []).filter((list) => list.kind === 'progress').map((list) => list.name))
        const tagsResponse = await tagsApi.list(board.id)
        return { board, lists: listsResponse.data || [], tags: tagsResponse.data || [], allTasks: tasksResponse.data || [], tasks: (tasksResponse.data || []).filter((task) => progressNames.has(task.list)) }
      }))
      if (!cancelled) { setBoards(loaded); setRecords(data) }
    }).catch(() => { if (!cancelled) { setBoards([]); setRecords([]) } }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open])

  const activity = useMemo(() => new Set(records.flatMap(({ tasks }) => tasks.filter((task) => task.deadline).map((task) => parseDate(task.deadline)))), [records])
  const grouped = (predicate) => records.map(({ board, lists, tags, allTasks, tasks }) => ({ board, lists, tags, allTasks, tasks: tasks.filter(predicate) })).filter(({ tasks }) => tasks.length)
  const overdue = useMemo(() => grouped((task) => parseDate(task.deadline) && parseDate(task.deadline) < selected), [records, selected])
  const due = useMemo(() => grouped((task) => parseDate(task.deadline) === selected), [records, selected])
  const upcoming = useMemo(() => grouped((task) => parseDate(task.deadline) > selected), [records, selected])
  const selectedDate = new Date(`${selected}T12:00:00`)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[40] flex flex-col bg-[#35506b] text-slate-800">
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#22384d] px-5 py-4 text-white shadow-lg">
        <div><h1 className="text-lg font-extrabold">Планировщик</h1><p className="text-xs text-white/60">Global Daily Focus · все доски</p></div>
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white">Закрыть ×</button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row bg-[#35506b]">
        <aside className="w-full shrink-0 overflow-y-auto border-b border-slate-200 bg-white p-4 md:w-72 md:border-b-0 md:border-r lg:w-80">
          <div className="mb-4 flex items-center justify-between gap-2"><button type="button" onClick={() => setMonth((value) => shiftMonth(value, -1))} className="rounded-lg px-3 py-1 text-lg hover:bg-slate-100">‹</button><span className="text-xs text-slate-400">Календарь</span><button type="button" onClick={() => setMonth((value) => shiftMonth(value, 1))} className="rounded-lg px-3 py-1 text-lg hover:bg-slate-100">›</button></div>
          <CalendarMonth month={month} selected={selected} activity={activity} onSelect={setSelected} />
          <CalendarMonth month={shiftMonth(month, 1)} selected={selected} activity={activity} onSelect={setSelected} />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto bg-[#35506b] p-4 md:p-6">
          <div className="mx-auto max-w-4xl"><div className="mb-6 rounded-2xl border border-white/10 bg-white/10 p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Выбранная дата</p><h2 className="text-2xl font-extrabold capitalize text-white">{selectedDate.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2></div>
            {loading ? <p className="py-12 text-center text-sm text-slate-400">Загрузка задач со всех досок…</p> : <div className="space-y-8"><GroupedFeed title="Просроченные" tasksByBoard={overdue} onEdit={onEdit} tone="red" empty="Просроченных задач нет" /><GroupedFeed title="Завершить" tasksByBoard={due} onEdit={onEdit} tone="amber" empty="На эту дату задач к завершению нет" /><GroupedFeed title="В работе" tasksByBoard={upcoming} onEdit={onEdit} tone="slate" empty="Нет незавершённых задач с более поздним дедлайном" /></div>}
          </div>
        </main>
      </div>
    </div>
  )
}
