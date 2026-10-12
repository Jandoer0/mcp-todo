import { useEffect, useRef, useState } from 'react'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

function pad(n) {
  return String(n).padStart(2, '0')
}

function toLocalValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatLabel(value) {
  if (!value) return ''
  const [d, t] = value.split('T')
  return `${d.split('-').reverse().join('.')} ${t}`
}

const PANEL_HEIGHT = 400 // approximate rendered height in px

export default function DateTimePicker({ id, name, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const [view, setView] = useState(() => {
    const base = value ? new Date(value) : new Date()
    return { year: base.getFullYear(), month: base.getMonth() }
  })
  const rootRef = useRef(null)

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openAt = (val) => {
    const base = val ? new Date(val) : new Date()
    if (!Number.isNaN(base.getTime())) {
      setView({ year: base.getFullYear(), month: base.getMonth() })
    }
    // Flip upward when there is not enough room below (e.g. inside a modal).
    // Measure against the nearest scrollable ancestor, not the window.
    if (rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect()
      let box = { bottom: window.innerHeight, top: 0 }
      let el = rootRef.current.parentElement
      while (el) {
        const st = getComputedStyle(el)
        if (/(auto|scroll)/.test(st.overflowY)) { box = el.getBoundingClientRect(); break }
        el = el.parentElement
      }
      const below = box.bottom - rect.bottom
      const above = rect.top - box.top
      setDropUp(below < PANEL_HEIGHT && above > below)
    }
    setOpen(true)
  }

  const shiftMonth = (delta) => {
    setView((v) => {
      const m = v.month + delta
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 }
    })
  }

  const emit = (date) => {
    const next = toLocalValue(date)
    onChange({ target: { name, value: next } })
  }

  const pickDay = (day) => {
    const [h, min] = (value ? value.split('T')[1] : '12:00').split(':').map(Number)
    emit(new Date(view.year, view.month, day, h || 0, min || 0))
  }

  const setTime = (h, min) => {
    if (!value) {
      const now = new Date()
      emit(new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min))
      return
    }
    const [d] = value.split('T')
    const [y, m, day] = d.split('-').map(Number)
    emit(new Date(y, m - 1, day, h, min))
  }

  const [curH, curM] = value && value.includes('T') ? value.split('T')[1].split(':').map(Number) : [12, 0]

  // Calendar grid: Monday-first, 6 rows.
  const first = new Date(view.year, view.month, 1)
  const startOffset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const today = new Date()
  const isToday = (d) =>
    d === today.getDate() && view.month === today.getMonth() && view.year === today.getFullYear()
  const isSelected = (d) => {
    if (!value) return false
    const sel = new Date(value)
    return (
      d === sel.getDate() &&
      view.month === sel.getMonth() &&
      view.year === sel.getFullYear()
    )
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id={id}
        onClick={() => (open ? setOpen(false) : openAt(value))}
        className={`w-full p-2 border rounded text-left text-sm flex items-center justify-between gap-2 bg-white ${
          open ? 'border-blue-500 ring-1 ring-blue-400' : ''
        }`}
      >
        <span className={value ? '' : 'text-slate-400'}>{value ? formatLabel(value) : placeholder}</span>
        <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute z-50 p-3 bg-white border border-slate-300 rounded-lg shadow-xl w-[286px] ${
            dropUp ? 'bottom-full mb-1' : 'mt-1'
          }`}
          role="dialog"
          aria-label="Выбор даты и времени"
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="w-7 h-7 rounded hover:bg-slate-100 text-slate-600"
              aria-label="Предыдущий месяц"
            >
              ‹
            </button>
            <div className="text-sm font-semibold text-slate-700">
              {MONTHS[view.month]} {view.year}
            </div>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="w-7 h-7 rounded hover:bg-slate-100 text-slate-600"
              aria-label="Следующий месяц"
            >
              ›
            </button>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map((w) => (
              <div key={w} className="text-center text-[11px] font-semibold text-slate-400 py-1">
                {w}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((d, i) =>
              d === null ? (
                <div key={`e${i}`} />
              ) : (
                <button
                  key={d}
                  type="button"
                  onClick={() => pickDay(d)}
                  className={`h-8 w-8 mx-auto rounded text-sm ${
                    isSelected(d)
                      ? 'bg-blue-600 text-white font-semibold'
                      : isToday(d)
                        ? 'border border-blue-400 text-blue-600 hover:bg-blue-50'
                        : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {d}
                </button>
              ),
            )}
          </div>

          {/* Time row */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-200">
            <span className="text-xs font-semibold text-slate-500">Время</span>
            <select
              value={curH}
              onChange={(e) => setTime(Number(e.target.value), curM)}
              className="border rounded px-1 py-1 text-sm bg-white"
              aria-label="Час"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{pad(h)}</option>
              ))}
            </select>
            <span className="text-slate-400">:</span>
            <select
              value={curM}
              onChange={(e) => setTime(curH, Number(e.target.value))}
              className="border rounded px-1 py-1 text-sm bg-white"
              aria-label="Минуты"
            >
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                <option key={m} value={m}>{pad(m)}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                onChange({ target: { name, value: '' } })
                setOpen(false)
              }}
              className="ml-auto text-xs text-red-500 hover:underline"
            >
              Очистить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
