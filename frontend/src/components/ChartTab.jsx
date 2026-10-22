import { useEffect, useMemo, useState } from 'react'
import { boardsApi } from '../api/client'

// Вкладка «График» — финансовый симулятор доски. Бэкенд (/cashflow) отдаёт
// события: «спик» (одна дата → вся сумма в один день) и «поток» (интервал
// → сумма равномерно на каждый день). Здесь строится ежедневный баланс,
// подсвечиваются кассовые разрывы и детализируется выбранный день.
// Все суммы — в валюте расчёта доски (Decimal на бэкенде).

// Signed money: "-10 000" / "+20 000"
function signed(n) {
  const v = Math.abs(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
  return `${n < 0 ? '-' : '+'}${v}`
}

function shortDate(iso) {
  // Принимает ISO-строку ("2026-11-23") или объект Date.
  const d = iso instanceof Date ? iso : new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

// Левая/правая граница видимого окна (Date) — для подписи периода.
function windowEdge(win, side) {
  const d = new Date(win.start)
  d.setDate(d.getDate() + (side === 'end' ? win.spanDays : 0))
  return d
}

function longDate(iso) {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

const dayKey = (d) => d.toISOString().slice(0, 10)

export default function ChartTab({ board, data: externalCashflow = undefined }) {
  // В BudgetView (ТЗv2 §4) данные приходят снаружи — из общего загрузчика
  // оболочки; автономная загрузка сохранена как fallback для прямого использования.
  const [ownData, setOwnData] = useState(null)
  const [selected, setSelected] = useState(null) // ISO-дата дня
  const [showDone, setShowDone] = useState(true)

  // Окно по умолчанию: от «сегодня» до max(последнее событие, +90 дней).
  // Хранится как { start: Date, spanDays: число дней } — стрелки сдвигают весь
  // видимый диапазон синхронно (привычный размер ряда сохраняется).
  const [win, setWin] = useState(null)
  const WEEK = 7 * 24 * 60 * 60 * 1000 // шаг смещения окна — 1 неделя

  useEffect(() => {
    if (externalCashflow !== undefined || !board?.id) return
    boardsApi
      .cashflow(board.id)
      .then((res) => setOwnData(res.data))
      .catch(() => setOwnData(null))
  }, [board?.id, externalCashflow])

  const data = externalCashflow !== undefined ? externalCashflow : ownData

  // Инициализация окна просмотра — при каждой новой порции данных (из
  // оболочки или из собственной загрузки).
  useEffect(() => {
    if (!data) return
    const events = data.events || []
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    let last = new Date(today)
    last.setDate(last.getDate() + 90)
    for (const e of events) {
      const end = new Date(`${e.end}T12:00:00`)
      if (end > last) last = end
    }
    // Начало окна: сегодня, но не позже раннего ФАКТА (реального платежа
    // из истории) — иначе недавние фактические движения (например, платёж
    // позавчера) не видны на графике без ручного сдвига окна назад.
    let start = new Date(today)
    for (const e of events) {
      if (!e.actual) continue
      const s = new Date(`${e.start}T12:00:00`)
      if (s < start) start = s
    }
    setWin({ start, spanDays: Math.round((last - start) / (24 * 60 * 60 * 1000)) })
  }, [data])

  // Ряд дней: внутри текущего окна просмотра.
  const days = useMemo(() => {
    if (!data || !win) return []
    const out = []
    const end = new Date(win.start)
    end.setDate(end.getDate() + win.spanDays)
    for (const d = new Date(win.start); d <= end; d.setDate(d.getDate() + 1)) {
      out.push({ key: dayKey(d), date: new Date(d) })
    }
    return out
  }, [data, win])

  // Полный ряд баланса: от первой до последней финансовой даты (объединяя
  // окно просмотра и все события). Накопленный баланс считается по всей ленте,
  // а не от начала окна — иначе событие, «уехавшее» за край окна, вычёркивалось
  // бы из баланса и ложно рождало кассовые разрывы.
  const fullDays = useMemo(() => {
    if (!data || !days.length) return []
    const events = (data.events || []).filter((e) => showDone || !e.done || e.actual)
    let start = new Date(days[0].date)
    let end = new Date(days[days.length - 1].date)
    for (const e of events) {
      const es = new Date(`${e.start}T12:00:00`)
      const ee = new Date(`${e.end}T12:00:00`)
      if (es < start) start = es
      if (ee > end) end = ee
    }
    const out = []
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      out.push({ key: dayKey(d), date: new Date(d) })
    }
    return out
  }, [data, days, showDone])

  const fullSeries = useMemo(() => {
    if (!data || !fullDays.length) return []
    // Фактические итерации регулярных платежей участвуют всегда (done=True):
    // ретроспектива «сколько реально тратил» не выключается вместе с планом.
    const events = (data.events || []).filter((e) => showDone || !e.done || e.actual)
    const change = new Map() // key → { delta, parts: [{title, amount, type, done}] }
    for (const e of events) {
      const per = e.per_day
      const push = (key) => {
        const cell = change.get(key) || { delta: 0, parts: [] }
        cell.delta += per
        cell.parts.push({ title: e.title, amount: per, type: e.type, done: e.done, actual: e.actual })
        change.set(key, cell)
      }
      if (e.type === 'stream') {
        for (const d of fullDays) {
          if (d.key >= e.start && d.key <= e.end) push(d.key)
        }
      } else {
        push(e.start)
      }
    }
    let balance = 0
    return fullDays.map((d) => {
      const cell = change.get(d.key)
      const delta = cell ? cell.delta : 0
      balance += delta
      return { key: d.key, delta, balance, parts: cell ? cell.parts : [] }
    })
  }, [data, fullDays, showDone])

  // Срез полного ряда под текущее окно просмотра (для отображения/навигации).
  const series = useMemo(() => {
    const winKeys = new Set(days.map((d) => d.key))
    return fullSeries.filter((p) => winKeys.has(p.key))
  }, [fullSeries, days])

  const breaks = useMemo(() => series.filter((p) => p.balance < 0), [series])
  const minBalance = useMemo(() => series.reduce((m, p) => Math.min(m, p.balance), 0), [series])

  // Шаг по дням от выбранного: -1 назад, +1 вперёд (кламп по краям ряда).
  const moveSelected = (delta) => {
    if (!selected || series.length === 0) return
    const i = series.findIndex((p) => p.key === selected)
    if (i < 0) return
    const next = Math.min(series.length - 1, Math.max(0, i + delta))
    setSelected(series[next].key)
  }

  // Десктоп: стрелки ←/→ перемещают выбранный день.
  // Не перехватываем ввод в полях (input/textarea/contenteditable) и модалках.
  useEffect(() => {
    if (!selected) return
    const onKey = (e) => {
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        moveSelected(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        moveSelected(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const currency = data?.report_currency?.code || ''
  const selectedPoint = selected ? series.find((p) => p.key === selected) : null
  const selectedIndex = selected ? series.findIndex((p) => p.key === selected) : -1
  const atStart = selectedIndex <= 0
  const atEnd = selectedIndex < 0 || selectedIndex >= series.length - 1

  // Границы окна просмотра: можно ли ещё сдвигать влево/вправо.
  // Окно не должно выходить за границы data.window (min/max ±5 дней).
  const atWindowStart = !win || !data?.window || win.start.toISOString().slice(0, 10) <= data.window.start
  const atWindowEnd = !win || !data?.window || win.start.toISOString().slice(0, 10) >= data.window.end

  // Кнопка «Сегодня» неактивна, когда окно уже на сегодня (или данных нет).
  const atToday =
    !win ||
    (() => {
      const now = new Date()
      now.setHours(12, 0, 0, 0)
      return dayKey(win.start) === dayKey(now)
    })()

  // Сдвиг всего графика на неделю (вперёд/назад) с клампом по границам
  // данных: «сегодня» может лежать за пределами окна (все задачи в прошлом),
  // поэтому шаг прижимается к min/max, а не блокируется.
  const moveWindow = (direction) => {
    if (!win || !data?.window) return
    const min = new Date(data.window.start)
    const max = new Date(data.window.end)
    const next = new Date(win.start.getTime() + direction * WEEK)
    if (direction < 0 && next < min) next.setTime(min.getTime())
    if (direction > 0 && next > max) next.setTime(max.getTime())
    next.setHours(12, 0, 0, 0)
    setWin({ ...win, start: next })
    setSelected(null)
  }

  // Быстрый возврат к сегодняшнему дню: окно центрируется относительно «сегодня».
  const resetToday = () => {
    if (!win) return
    const now = new Date()
    now.setHours(12, 0, 0, 0)
    setWin({ ...win, start: now })
    setSelected(null)
  }

  if (!data) return <p className="text-sm text-slate-500">Загрузка графика…</p>

  return (
    <div className="space-y-4">
      {data.missing_rate && (
        <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          ⚠ У одной или нескольких валют не указан курс — обновите «Параметры валют», иначе график будет неполным.
        </p>
      )}

      {/* Панель навигации по шкале времени */}
      {days.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-slate-200 bg-card p-2.5 shadow-sm">
          <button
            type="button"
            onClick={() => moveWindow(-1)}
            disabled={atWindowStart}
            aria-label="На неделю назад"
            className="h-9 w-9 shrink-0 rounded-full border border-slate-200 bg-white text-lg leading-none text-slate-700 shadow-sm active:bg-slate-100 disabled:opacity-40"
          >
            ‹
          </button>
          <span className="min-w-[10rem] shrink-0 text-center text-sm font-semibold text-slate-700 tabular-nums">
            {win
              ? `${shortDate(windowEdge(win, 'start'))} — ${shortDate(windowEdge(win, 'end'))}`
              : 'Период'}
          </span>
          <button
            type="button"
            onClick={() => moveWindow(1)}
            disabled={atWindowEnd}
            aria-label="На неделю вперёд"
            className="h-9 w-9 shrink-0 rounded-full border border-slate-200 bg-white text-lg leading-none text-slate-700 shadow-sm active:bg-slate-100 disabled:opacity-40"
          >
            ›
          </button>
          <button
            type="button"
            onClick={resetToday}
            disabled={atToday}
            aria-label="Вернуться к сегодняшнему дню"
            className="ml-2 rounded-lg border border-green-600 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-50 disabled:opacity-40"
          >
            Сегодня
          </button>
        </div>
      )}

      {/* График баланса (SVG) */}
      {series.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-card p-3 shadow-sm overflow-x-auto">
          <BalanceChart series={series} selected={selected} onSelect={setSelected} />
          <MonthLabels series={series} />
          <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400 tabular-nums">
            <span>{shortDate(series[0].key)}</span>
            <span>{shortDate(series[series.length - 1].key)}</span>
          </div>
        </div>
      )}

      {/* Кассовые разрывы — компактно, максимум 2 строки:
          1) заголовок + мин. баланс в одну строку; 2) чипы без переноса с обрезкой */}
      {breaks.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm font-semibold text-red-700 truncate">
              ⚠ Кассовые разрывы ({breaks.length})
            </div>
            <div className="shrink-0 text-xs text-red-600 tabular-nums">
              мин. {signed(minBalance)} {currency}
            </div>
          </div>
          <div className="mt-1 flex gap-1.5 overflow-hidden">
            {breaks.slice(0, 6).map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => setSelected(b.key)}
                title={`${longDate(b.key)} · ${signed(b.balance)} ${currency}`}
                className="shrink-0 rounded-full bg-white border border-red-300 px-2 py-0.5 text-[11px] font-semibold text-red-600 tabular-nums hover:bg-red-100"
              >
                {shortDate(b.key)} · {signed(b.balance)}
              </button>
            ))}
            {breaks.length > 6 && (
              <span className="text-[11px] text-red-500 self-center shrink-0">
                +{breaks.length - 6}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Детализация выбранного дня */}
      {selectedPoint && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm font-semibold capitalize text-slate-700">{longDate(selectedPoint.key)}</div>
            <button type="button" onClick={() => setSelected(null)} className="text-xs text-slate-500 hover:text-slate-700">
              Закрыть
            </button>
          </div>
          <div className="hidden sm:block text-[10px] text-slate-400 mt-0.5">
            Переключайте дни клавишами ← и →
          </div>
          <div className={`mt-1 text-2xl font-extrabold tabular-nums ${selectedPoint.balance < 0 ? 'text-red-600' : 'text-green-600'}`}>
            Баланс: {signed(selectedPoint.balance)} {currency}
          </div>
          <div className={`text-sm font-semibold tabular-nums ${selectedPoint.delta < 0 ? 'text-red-500' : selectedPoint.delta > 0 ? 'text-green-600' : 'text-slate-400'}`}>
            Изменение за день: {selectedPoint.delta ? signed(selectedPoint.delta) : '0'} {currency}
          </div>
          <div className="mt-2 divide-y divide-slate-100 rounded border border-slate-200 bg-white">
            {selectedPoint.parts.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-slate-400">В этот день движений по суммам нет</p>
            ) : (
              selectedPoint.parts.map((p, i) => (
                <div key={`${p.title}-${i}`} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                  <span className="flex items-center gap-1.5 truncate">
                    <span className={`shrink-0 rounded px-1 text-[10px] font-bold uppercase ${
                      p.actual
                        ? 'bg-teal-100 text-teal-700'
                        : p.type === 'stream'
                          ? 'bg-blue-100 text-blue-600'
                          : 'bg-amber-100 text-amber-600'
                    }`}>
                      {p.actual ? 'факт' : p.type === 'stream' ? 'поток' : 'спик'}
                    </span>
                    <span className={`truncate ${p.done ? 'text-slate-400 line-through' : 'text-slate-700'}`} title={p.title}>{p.title}</span>
                  </span>
                  <span className={`shrink-0 font-mono tabular-nums ${p.amount < 0 ? 'text-red-500' : 'text-green-600'}`}>{signed(p.amount)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Мобильная навигация по дням: плавающие кнопки внизу экрана */}
      {selectedPoint && (
        <div className="fixed inset-x-0 bottom-4 z-[60] flex items-center justify-center gap-2 px-4 sm:hidden">
          <button
            type="button"
            onClick={() => moveSelected(-1)}
            disabled={atStart}
            aria-label="Предыдущий день"
            className="h-12 w-12 shrink-0 rounded-full border border-slate-200 bg-white text-2xl leading-none text-slate-700 shadow-lg active:bg-slate-100 disabled:opacity-40"
          >
            ←
          </button>
          <div className="min-w-[7rem] rounded-full border border-blue-200 bg-white px-3 py-1.5 text-center text-xs font-semibold text-slate-600 shadow-lg tabular-nums">
            {shortDate(selectedPoint.key)}
            <span className="block font-normal text-slate-400">день {selectedIndex + 1} из {series.length}</span>
          </div>
          <button
            type="button"
            onClick={() => moveSelected(1)}
            disabled={atEnd}
            aria-label="Следующий день"
            className="h-12 w-12 shrink-0 rounded-full border border-slate-200 bg-white text-2xl leading-none text-slate-700 shadow-lg active:bg-slate-100 disabled:opacity-40"
          >
            →
          </button>
        </div>
      )}

      {/* Легенда + переключатель завершённых */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> спик — разовый платёж</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400" /> поток — сумма на каждый день интервала</span>
        <span className="flex items-center gap-1" title="Завершённые итерации регулярных платежей — фактические суммы">
          <span className="h-2 w-2 rounded-full bg-teal-500" /> факт — реальные платежи из истории</span>
        <label className="ml-auto flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="accent-green-600" />
          Учитывать завершённые
        </label>
      </div>
    </div>
  )
}

// Подписи месяцев под графиком: один тег на месяц видимого ряда, ширина
// блока пропорциональна числу дней месяца в ряду; зеркалит геометрию
// BalanceChart (pad + 7 px на день при W = series.length * 7).
function MonthLabels({ series }) {
  if (!series.length) return null
  const W = Math.max(560, series.length * 7)
  const pad = { left: 4, right: 4 }
  const x = (i) => pad.left + (i / (series.length - 1)) * (W - pad.left - pad.right)

  // Собираем сегменты [от индекса, до индекса] по смене месяца.
  const segments = []
  let cur = null
  series.forEach((p, i) => {
    const d = new Date(`${p.key}T00:00:00`)
    const label = d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    if (!cur || cur.label !== label) {
      cur = { label, from: i, to: i }
      segments.push(cur)
    } else {
      cur.to = i
    }
  })

  return (
    <div className="relative h-4 mt-0.5" aria-hidden="true">
      {segments.map((s) => {
        // Границы сегмента в px контейнера (ширина = viewBox) — сам блок
        // растягивается на всю ширину, как и SVG (w-full), поэтому проценты
        // совпадают с координатами viewBox.
        const x0 = x(Math.max(0, s.from - 0.5))
        const x1 = x(Math.min(series.length - 1, s.to + 0.5))
        return (
          <div
            key={s.label + s.from}
            className="absolute top-0 h-4 overflow-hidden text-[10px] font-medium capitalize text-slate-400"
            style={{ left: `${(x0 / W) * 100}%`, width: `${((x1 - x0) / W) * 100}%` }}
          >
            {s.label}
          </div>
        )
      })}
    </div>
  )
}

// SVG-график: линия баланса, нулевая линия, маркеры спиков, вертикальные
// линии разрывов, вертикальные разделители месяцев, выбор дня по клику.
function BalanceChart({ series, selected, onSelect }) {
  const W = Math.max(560, series.length * 7)
  const H = 160
  const pad = { top: 14, bottom: 10, left: 4, right: 4 }
  const values = series.map((p) => p.balance)
  const maxV = Math.max(...values, 0)
  const minV = Math.min(...values, 0)
  const range = maxV - minV || 1
  const y = (v) => pad.top + ((maxV - v) / range) * (H - pad.top - pad.bottom)
  const x = (i) => pad.left + (i / (series.length - 1)) * (W - pad.left - pad.right)

  const zeroY = y(0)
  const line = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ')
  const area = `${line} L${x(series.length - 1).toFixed(1)},${zeroY} L${x(0).toFixed(1)},${zeroY} Z`

  // Первый день каждого нового месяца — позиция вертикального разделителя
  // (дни ряда всегда идут подряд, поэтому достаточно проверить число).
  const monthBorders = series
    .map((p, i) => ({ i, day: new Date(`${p.key}T00:00:00`).getDate() }))
    .filter(({ i, day }) => i > 0 && day === 1)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full cursor-crosshair"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const px = ((e.clientX - rect.left) / rect.width) * W
        const i = Math.round(((px - pad.left) / (W - pad.left - pad.right)) * (series.length - 1))
        const idx = Math.min(series.length - 1, Math.max(0, i))
        onSelect(series[idx].key)
      }}
    >
      <defs>
        <linearGradient id="balPos" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(34 197 94)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="rgb(34 197 94)" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="balNeg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(239 68 68)" stopOpacity="0.05" />
          <stop offset="100%" stopColor="rgb(239 68 68)" stopOpacity="0.25" />
        </linearGradient>
        <clipPath id="posClip"><rect x="0" y="0" width={W} height={zeroY} /></clipPath>
      </defs>

      {/* область ниже нуля — красная */}
      {minV < 0 && (
        <>
          <rect x={pad.left} y={zeroY} width={W - pad.left - pad.right} height={H - pad.bottom - zeroY} fill="url(#balNeg)" />
          <line x1={pad.left} x2={W - pad.right} y1={zeroY} y2={zeroY} stroke="rgb(239 68 68)" strokeDasharray="4 3" strokeWidth="1" />
        </>
      )}
      {/* заливка над нулём — зелёная */}
      <path d={area} fill="url(#balPos)" clipPath="url(#posClip)" />

      {/* вертикали кассовых разрывов */}
      {series.map((p, i) =>
        p.balance < 0 ? (
          <line key={p.key} x1={x(i)} x2={x(i)} y1={pad.top} y2={H - pad.bottom} stroke="rgb(252 165 165)" strokeWidth="1" />
        ) : null,
      )}

      {/* вертикальные разделители месяцев: линия на 1-м числе каждого месяца —
          рисуется ПОСЛЕ линий разрывов, чтобы не теряться среди них */}
      {monthBorders.map(({ i }) => (
        <line
          key={`m${series[i].key}`}
          x1={x(i)}
          x2={x(i)}
          y1={pad.top}
          y2={H - pad.bottom}
          stroke="rgb(148 163 184)"
          strokeWidth="1.5"
        />
      ))}

      <path d={line} fill="none" stroke="rgb(30 64 120)" strokeWidth="1.8" />

      {/* маркеры спиков (дни с разовым движением); фактические платежи —
          бирюзовые, плановые — янтарные; несколько движений в один день
          рисуются «столбиком», крупный платёж не затирается мелким */}
      {series.flatMap((p, i) =>
        p.parts
          .filter((pt) => pt.type === 'spike')
          .map((pt, j) => (
            <circle
              key={`${p.key}-${j}`}
              cx={x(i)}
              cy={y(p.balance) - j * 3}
              r={pt.actual ? 3 : 2.4}
              fill={pt.actual ? 'rgb(20 184 166)' : 'rgb(251 191 36)'}
            />
          )),
      )}

      {/* выбранный день */}
      {selected &&
        (() => {
          const i = series.findIndex((p) => p.key === selected)
          if (i < 0) return null
          return (
            <g>
              <line x1={x(i)} x2={x(i)} y1={pad.top} y2={H - pad.bottom} stroke="rgb(59 130 246)" strokeWidth="1.5" />
              <circle cx={x(i)} cy={y(series[i].balance)} r="3.5" fill="rgb(59 130 246)" />
            </g>
          )
        })()}
    </svg>
  )
}
