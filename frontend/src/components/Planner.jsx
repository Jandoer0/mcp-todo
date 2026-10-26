import { useEffect, useMemo, useState } from 'react'
import { boardsApi, listsApi, tasksApi } from '../api/client'

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

function BoardGroup({ board, tasks }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <h3 className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700">{board.name}</h3>
      <div className="divide-y divide-slate-100">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0 truncate text-sm text-slate-700">{task.title}</span>
            <span className="shrink-0 text-xs tabular-nums text-slate-400">
              {task.deadline ? new Date(task.deadline).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : 'без даты'}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function GroupedFeed({ title, tasksByBoard, empty }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-extrabold text-slate-800">{title}</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{tasksByBoard.reduce((sum, item) => sum + item.tasks.length, 0)}</span>
      </div>
      {tasksByBoard.length ? <div className="space-y-3">{tasksByBoard.map((item) => <BoardGroup key={item.board.id} {...item} />)}</div> : <p className="rounded-xl border border-dashed border-slate-200 bg-white/70 px-4 py-6 text-center text-sm text-slate-400">{empty}</p>}
    </section>
  )
}

export default function Planner({ open, onClose }) {
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
        return { board, tasks: (tasksResponse.data || []).filter((task) => progressNames.has(task.list)) }
      }))
      if (!cancelled) { setBoards(loaded); setRecords(data) }
    }).catch(() => { if (!cancelled) { setBoards([]); setRecords([]) } }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open])

  const activity = useMemo(() => new Set(records.flatMap(({ tasks }) => tasks.filter((task) => task.deadline).map((task) => parseDate(task.deadline)))), [records])
  const grouped = (predicate) => records.map(({ board, tasks }) => ({ board, tasks: tasks.filter(predicate) })).filter(({ tasks }) => tasks.length)
  const due = useMemo(() => grouped((task) => parseDate(task.deadline) === selected), [records, selected])
  const upcoming = useMemo(() => grouped((task) => parseDate(task.deadline) > selected), [records, selected])
  const selectedDate = new Date(`${selected}T12:00:00`)

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-100 text-slate-800">
      <header className="flex shrink-0 items-center justify-between bg-[#22384d] px-4 py-3 text-white shadow-lg">
        <div><h1 className="text-lg font-extrabold">Планировщик</h1><p className="text-xs text-white/60">Global Daily Focus · все доски</p></div>
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white">Закрыть ×</button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="w-full shrink-0 overflow-y-auto border-b border-slate-200 bg-white p-4 md:w-72 md:border-b-0 md:border-r lg:w-80">
          <div className="mb-4 flex items-center justify-between gap-2"><button type="button" onClick={() => setMonth((value) => shiftMonth(value, -1))} className="rounded-lg px-3 py-1 text-lg hover:bg-slate-100">‹</button><span className="text-xs text-slate-400">Календарь</span><button type="button" onClick={() => setMonth((value) => shiftMonth(value, 1))} className="rounded-lg px-3 py-1 text-lg hover:bg-slate-100">›</button></div>
          <CalendarMonth month={month} selected={selected} activity={activity} onSelect={setSelected} />
          <CalendarMonth month={shiftMonth(month, 1)} selected={selected} activity={activity} onSelect={setSelected} />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto max-w-3xl"><div className="mb-6"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Выбранная дата</p><h2 className="text-2xl font-extrabold capitalize text-slate-800">{selectedDate.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2></div>
            {loading ? <p className="py-12 text-center text-sm text-slate-400">Загрузка задач со всех досок…</p> : <div className="space-y-8"><GroupedFeed title="Завершить" tasksByBoard={due} empty="На эту дату задач к завершению нет" /><GroupedFeed title="В работе" tasksByBoard={upcoming} empty="Нет незавершённых задач с более поздним дедлайном" /></div>}
          </div>
        </main>
      </div>
    </div>
  )
}
