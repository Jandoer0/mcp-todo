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
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function longDate(iso) {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

const dayKey = (d) => d.toISOString().slice(0, 10)

export default function ChartTab({ board }) {
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(null) // ISO-дата дня
  const [showDone, setShowDone] = useState(true)

  useEffect(() => {
    if (!board?.id) return
    boardsApi
      .cashflow(board.id)
      .then((res) => setData(res.data))
      .catch(() => setData(null))
  }, [board?.id])

  // Ряд дней: от сегодня до max(дата последнего события, +90 дней).
  const days = useMemo(() => {
    if (!data) return []
    const events = (data.events || []).filter((e) => showDone || !e.done)
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    let last = new Date(today)
    last.setDate(last.getDate() + 90)
    for (const e of events) {
      const end = new Date(`${e.end}T12:00:00`)
      if (end > last) last = end
    }
    const out = []
    for (const d = new Date(today); d <= last; d.setDate(d.getDate() + 1)) {
      out.push({ key: dayKey(d), date: new Date(d) })
    }
    return out
  }, [data, showDone])

  // Ежедневное изменение и накопленный баланс.
  const series = useMemo(() => {
    if (!data) return []
    const events = (data.events || []).filter((e) => showDone || !e.done)
    const change = new Map() // key → { delta, parts: [{title, amount, type, done}] }
    for (const e of events) {
      const per = e.per_day
      const push = (key) => {
        const cell = change.get(key) || { delta: 0, parts: [] }
        cell.delta += per
        cell.parts.push({ title: e.title, amount: per, type: e.type, done: e.done })
        change.set(key, cell)
      }
      if (e.type === 'stream') {
        for (const d of days) {
          if (d.key >= e.start && d.key <= e.end) push(d.key)
        }
      } else {
        push(e.start)
      }
    }
    let balance = 0
    return days.map((d) => {
      const cell = change.get(d.key)
      const delta = cell ? cell.delta : 0
      balance += delta
      return { key: d.key, delta, balance, parts: cell ? cell.parts : [] }
    })
  }, [data, days, showDone])

  const breaks = useMemo(() => series.filter((p) => p.balance < 0), [series])
  const minBalance = useMemo(() => series.reduce((m, p) => Math.min(m, p.balance), 0), [series])

  const currency = data?.report_currency?.code || ''
  const selectedPoint = selected ? series.find((p) => p.key === selected) : null

  if (!data) return <p className="text-sm text-slate-500">Загрузка графика…</p>

  return (
    <div className="space-y-4">
      {data.missing_rate && (
        <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          ⚠ У одной или нескольких валют не указан курс — обновите «Параметры валют», иначе график будет неполным.
        </p>
      )}

      {/* Кассовые разрывы */}
      {breaks.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <div className="text-sm font-semibold text-red-700">
            ⚠ Кассовые разрывы ({breaks.length})
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {breaks.slice(0, 12).map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => setSelected(b.key)}
                className="rounded-full bg-white border border-red-300 px-2.5 py-0.5 text-xs font-semibold text-red-600 tabular-nums hover:bg-red-100"
              >
                {shortDate(b.key)} · {signed(b.balance)}
              </button>
            ))}
            {breaks.length > 12 && <span className="text-xs text-red-500 self-center">и ещё {breaks.length - 12}…</span>}
          </div>
          <div className="mt-1 text-xs text-red-600">
            Минимальный прогнозный баланс: {signed(minBalance)} {currency}
          </div>
        </div>
      )}

      {/* График баланса (SVG) */}
      {series.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-card p-3 shadow-sm overflow-x-auto">
          <BalanceChart series={series} selected={selected} onSelect={setSelected} />
          <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400 tabular-nums">
            <span>{shortDate(series[0].key)}</span>
            <span>{shortDate(series[series.length - 1].key)}</span>
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
                    <span className={`shrink-0 rounded px-1 text-[10px] font-bold uppercase ${p.type === 'stream' ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600'}`}>
                      {p.type === 'stream' ? 'поток' : 'спик'}
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

      {/* Легенда + переключатель завершённых */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> спик — разовый платёж</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400" /> поток — сумма на каждый день интервала</span>
        <label className="ml-auto flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="accent-green-600" />
          Учитывать завершённые
        </label>
      </div>
    </div>
  )
}

// SVG-график: линия баланса, нулевая линия, маркеры спиков, вертикальные
// линии разрывов, выбор дня по клику.
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

      <path d={line} fill="none" stroke="rgb(30 64 120)" strokeWidth="1.8" />

      {/* маркеры спиков (дни с разовым движением) */}
      {series.map((p, i) =>
        p.parts.some((pt) => pt.type === 'spike') ? (
          <circle key={p.key} cx={x(i)} cy={y(p.balance)} r="2.4" fill="rgb(251 191 36)" />
        ) : null,
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
