import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useImperativeHandle, forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { boardsApi, listsApi, tagsApi, tasksApi } from '../api/client'
import { useSettings } from '../i18n/settings.jsx'
import { formatDate, LOCALE_TAG, monthGrid, weekdayKeys } from '../utils/locale'

const pad = (n) => String(n).padStart(2, '0')
const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const parseDate = (value) => (value ? String(value).slice(0, 10) : '')
// Индекс Date.getDay() → ключ перевода weekdays.short.
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function shiftMonth(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function CalendarMonth({ month, selected, activity, onSelect }) {
  const { t, i18n } = useTranslation()
  const { dateFormat, firstDayOfWeek } = useSettings()
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const { leading: offset, days: count } = monthGrid(first, firstDayOfWeek)
  const cells = []
  for (let i = 0; i < offset; i += 1) cells.push(null)
  for (let day = 1; day <= count; day += 1) cells.push(new Date(month.getFullYear(), month.getMonth(), day))
  while (cells.length % 7) cells.push(null)

  return (
    <section className="mb-6">
      <h3 className="mb-2 text-center text-sm font-bold capitalize text-white">
        {first.toLocaleDateString(LOCALE_TAG[i18n.language] || 'ru-RU', { month: 'long', year: 'numeric' })}
      </h3>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-white/70">
        {weekdayKeys(firstDayOfWeek).map((key) => (
          <span key={key} className="py-1 font-semibold">{t(`weekdays.short.${key}`)}</span>
        ))}
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

// Горизонтальная лента дат для мобильных: свайп влево/вправо прокручивает
// дни, тап выбирает дату. Активность (есть задачи с дедлайном) — точка.
// Каждая ячейка: день недели (микро-подпись) + число; между концом недели
// (по настройке «первый день недели») и началом новой — тонкий разделитель.
// Тёмная тема ленты: она часть «хрома» экрана и не сливается с белыми
// карточками задач ниже.
function DateStrip({ selected, activity, onSelect }) {
  const { t } = useTranslation()
  const { firstDayOfWeek } = useSettings()
  const stripRef = useRef(null)
  // Диапазон: текущий месяц + следующий (как в десктопном календаре).
  const now = new Date()
  const days = useMemo(() => {
    const out = []
    for (let m = 0; m < 2; m += 1) {
      const first = new Date(now.getFullYear(), now.getMonth() + m, 1)
      const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
      for (let d = 1; d <= count; d += 1) out.push(new Date(first.getFullYear(), first.getMonth(), d))
    }
    return out
  }, [now.getFullYear(), now.getMonth()])

  // Последний день недели: monday → воскресенье (0), sunday → суббота (6).
  const weekEndDay = firstDayOfWeek === 'sunday' ? 6 : 0

  // Прокрутить выбранную дату в центр при открытии/смене месяца.
  useEffect(() => {
    if (!stripRef.current || !selected) return
    const el = stripRef.current.querySelector(`[data-date="${selected}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selected])

  return (
    <div
      ref={stripRef}
      className="flex gap-1.5 overflow-x-auto px-4 py-2.5"
      style={{ scrollbarWidth: 'none' }}
    >
      {days.map((date) => {
        const key = keyOf(date)
        const active = key === selected
        const today = key === keyOf(new Date())
        return (
          <Fragment key={key}>
            <button
              data-date={key}
              type="button"
              onClick={() => onSelect(key)}
              className={`relative flex h-12 w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${active ? 'bg-green-500 font-bold text-white shadow-md' : 'bg-white/10 text-white/90 hover:bg-white/20'} ${today && !active ? 'ring-2 ring-amber-300/80' : ''}`}
            >
              <span className="text-[9px] leading-none opacity-70">{t(`weekdays.short.${DAY_KEYS[date.getDay()]}`)}</span>
              <span className="text-sm font-semibold leading-none">{date.getDate()}</span>
              {activity.has(key) && <span className={`absolute bottom-1 h-1 w-1 rounded-full ${active ? 'bg-white' : 'bg-amber-300'}`} />}
            </button>
            {date.getDay() === weekEndDay && <span className="my-1 w-px shrink-0 bg-white/20" aria-hidden="true" />}
          </Fragment>
        )
      })}
    </div>
  )
}

function BoardGroup({ board, tasks, allTasks, lists, tags = [], onEdit }) {
  const { t } = useTranslation()
  const { dateFormat } = useSettings()
  const listByName = new Map(lists.map((list) => [list.name, list]))
  const priorityKey = (p) => (p === 3 ? 'high' : p === 2 ? 'medium' : 'low')
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
                  title={t(`priorities.${priorityKey(task.priority)}`)}
                  aria-label={t(`priorities.${priorityKey(task.priority)}`)}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">{task.title}</span>
                {(task.tags || []).length > 0 && <div className="ml-auto flex min-w-0 shrink-0 max-w-[48%] items-center justify-end gap-1 overflow-hidden">{task.tags.map((tag, index) => { const name = typeof tag === 'string' ? tag : tag.name; return <span key={`${name}-${index}`} className="max-w-24 truncate rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: (typeof tag === 'object' && tag.color) || tags.find((item) => item.name === name)?.color || '#64748b' }} title={name}>{name}</span> })}</div>}
                <span className="shrink-0 text-xs tabular-nums text-slate-400">{task.deadline ? formatDate(task.deadline, dateFormat, t) : t('planner.noDate')}</span>
              </div>
              {blockers.length > 0 && <div className="mt-2 flex items-center gap-2"><span className="shrink-0 text-[10px] font-semibold text-slate-400">{t('planner.blockers')}</span><div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${percent}%` }} /></div><span className="shrink-0 text-[10px] tabular-nums text-slate-500">{done}/{blockers.length}</span></div>}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function GroupedFeed({ title, tasksByBoard, empty, onEdit, tone = 'slate' }) {
  const toneTitle =
    tone === 'red' ? 'text-red-100' : tone === 'amber' ? 'text-amber-100' : tone === 'teal' ? 'text-teal-100' : 'text-white'
  const toneBadge =
    tone === 'red' ? 'bg-red-200 text-red-800' : tone === 'amber' ? 'bg-amber-200 text-amber-800' : tone === 'teal' ? 'bg-teal-500/30 text-teal-100' : 'bg-white/20 text-white'
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className={`text-base font-extrabold ${toneTitle}`}>{title}</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs ${toneBadge}`}>{tasksByBoard.reduce((sum, item) => sum + item.tasks.length, 0)}</span>
      </div>
      {tasksByBoard.length ? <div className="space-y-3">{tasksByBoard.map((item) => <BoardGroup key={item.board.id} {...item} onEdit={onEdit} />)}</div> : (
        /* Пустая зона — в стиле кнопки «+ Добавить задачу»: полупрозрачная
           подложка на тёмном фоне, пунктирная рамка, светлый текст. */
        <p className="w-full rounded bg-white/5 border border-dashed border-white/20 px-4 py-6 text-center text-xs text-white/60">{empty}</p>
      )}
    </section>
  )
}

// Загрузить актуальные данные для всех досок пользователя.
const fetchPlannerData = async () => {
  const loaded = (await boardsApi.list()).data || []
  return Promise.all(
    loaded.map(async (board) => {
      const [tasksResponse, listsResponse, tagsResponse] = await Promise.all([
        tasksApi.list(board.id),
        listsApi.list(board.id),
        tagsApi.list(board.id),
      ])
      const listRows = listsResponse.data || []
      const progressNames = new Set(listRows.filter((list) => list.kind === 'progress').map((list) => list.name))
      const regularNames = new Set(listRows.filter((list) => list.kind === 'regular').map((list) => list.name))
      const allTasks = tasksResponse.data || []
      return {
        board,
        lists: listRows,
        tags: tagsResponse.data || [],
        allTasks,
        tasks: allTasks.filter((task) => progressNames.has(task.list)),
        regularTasks: allTasks.filter((task) => regularNames.has(task.list)),
      }
    }),
  )
}

// forwardRef + useImperativeHandle — App получает `refreshPlanner()`,
// чтобы сразу подгрузить актуальные задачи ПОСЛЕ удаления задачи:
// через useTasks они обновятся на доске, но Planning — отдельный fetch.
// fetch вызывается только при первом открытии (без моргания): данные
// загружаются из актуального fetch, который запускается синхронно
// с закрытием модального окна (App.jsx).
const PlannerWithImperative = forwardRef(function Planner(
  { open, onClose, onEdit },
  ref,
) {
  const { t, i18n } = useTranslation()
  const { dateFormat } = useSettings()
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selected, setSelected] = useState(() => keyOf(new Date()))
  const [boards, setBoards] = useState([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)

  const opened = useRef(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const data = await fetchPlannerData()
      setBoards(data.map((r) => r.board))
      setRecords(data)
    } catch {
      setBoards([])
      setRecords([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && !opened.current) {
      opened.current = true
      fetchData()
    }
    return () => { opened.current = false }
  }, [open])

  useImperativeHandle(ref, () => ({
    refreshPlanner: fetchData,
  }), [])

  const activity = useMemo(() => new Set(records.flatMap(({ tasks }) => tasks.filter((task) => task.deadline).map((task) => parseDate(task.deadline)))), [records])
  const grouped = (predicate, key = 'tasks') =>
    records
      .map((record) => ({ ...record, tasks: record[key].filter(predicate) }))
      .filter(({ tasks }) => tasks.length)
  const overdue = useMemo(() => grouped((task) => parseDate(task.deadline) && parseDate(task.deadline) < selected), [records, selected])
  const due = useMemo(() => grouped((task) => parseDate(task.deadline) === selected), [records, selected])
  const upcoming = useMemo(() => grouped((task) => parseDate(task.deadline) > selected), [records, selected])
  // Регулярные задачи: без фильтра по дате — активная итерация видна всегда
  // (как в колонке «Регулярные» на доске).
  const regular = useMemo(() => grouped(() => true, 'regularTasks'), [records])
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
      <header className="shrink-0 border-b border-white/10 bg-[#22384d] px-5 py-3 text-white shadow-lg">
        {/* Заголовок и дата — в одной строке, между ними дата, справа «Закрыть».
            Под список задач отдаётся вся оставшаяся высота. Дата форматируется
            по профилю (ТЗ §5), название дня — по языку интерфейса. */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="shrink-0 text-lg font-extrabold leading-tight">{t('planner.title')}</h1>
          {/* Дата выбранного дня — только на десктопе (в календаре-сайдбаре
              она и так видна); на мобильном в хедере — название и «Закрыть». */}
          <h2 className="hidden min-w-0 truncate text-center text-base font-extrabold capitalize leading-tight text-white md:block lg:text-lg">
            {selectedDate.toLocaleDateString(LOCALE_TAG[i18n.language] || 'ru-RU', { weekday: 'long' })}, {formatDate(selected, dateFormat, t)}
          </h2>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white">{t('planner.close')} ×</button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row bg-[#35506b]">
        {/* Мобильный: горизонтальная лента дат (свайп влево/вправо, тап = выбор).
            Десктоп: боковая колонка с календарём на два месяца. */}
        <div className="md:hidden shrink-0 border-b border-white/10 bg-[#2c4359]">
          <DateStrip
            selected={selected}
            activity={activity}
            onSelect={(key) => setSelected(key)}
          />
        </div>
        <aside className="hidden w-full shrink-0 overflow-y-auto border-white/10 bg-[#2c4359] p-4 md:block md:w-72 md:border-r lg:w-80">
          <div className="mb-4 flex items-center justify-between gap-2">
            <button type="button" onClick={() => setMonth((value) => shiftMonth(value, -1))} className="rounded-lg px-3 py-1 text-lg text-white/80 hover:bg-white/10 hover:text-white transition-colors">‹</button>
            <span className="text-xs text-white/60">{t('planner.calendar')}</span>
            <button type="button" onClick={() => setMonth((value) => shiftMonth(value, 1))} className="rounded-lg px-3 py-1 text-lg text-white/80 hover:bg-white/10 hover:text-white transition-colors">›</button>
          </div>
          <CalendarMonth month={month} selected={selected} activity={activity} onSelect={setSelected} />
          <CalendarMonth month={shiftMonth(month, 1)} selected={selected} activity={activity} onSelect={setSelected} />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto bg-[#35506b] p-4 md:p-6">
          <div className="mx-auto max-w-4xl">
            {loading ? <p className="py-12 text-center text-sm text-slate-400">{t('planner.loading')}</p> : <div className="space-y-8"><GroupedFeed title={t('planner.overdue')} tasksByBoard={overdue} onEdit={onEdit} tone="red" empty={t('planner.overdueEmpty')} /><GroupedFeed title={t('planner.due')} tasksByBoard={due} onEdit={onEdit} tone="amber" empty={t('planner.dueEmpty')} /><GroupedFeed title={t('planner.upcoming')} tasksByBoard={upcoming} onEdit={onEdit} tone="slate" empty={t('planner.upcomingEmpty')} /><GroupedFeed title={t('planner.regular')} tasksByBoard={regular} onEdit={onEdit} tone="teal" empty={t('planner.regularEmpty')} /></div>}
          </div>
        </main>
      </div>
    </div>
  )
})

export default PlannerWithImperative
