import { useMemo, useState } from 'react'

// System budget lists: tasks here count as executed budget (ТЗ §3.1).
const DONE_LISTS = ['Готово', 'Архив']

// 10000 → «10 000» (ru-RU uses non-breaking spaces as thousand separators)
function fmt(n) {
  return Math.abs(n).toLocaleString('ru-RU')
}

// Signed money without currency: "-10 000" / "+20 000"
function signed(n) {
  return `${n < 0 ? '-' : '+'}${fmt(n)}`
}

// Budget of a board: planned vs executed amounts (amount != 0 only).
export default function BudgetTab({ board, tasks = [] }) {
  const [copied, setCopied] = useState(false)

  const { plan, fact, entries, doneEntries } = useMemo(() => {
    const entries = tasks.filter((t) => (Number(t.amount) || 0) !== 0)
    const doneEntries = entries.filter((t) => DONE_LISTS.includes(t.list))
    const plan = entries.filter((t) => !DONE_LISTS.includes(t.list))
    return {
      entries,
      doneEntries,
      plan: plan.reduce((s, t) => s + Number(t.amount), 0),
      fact: doneEntries.reduce((s, t) => s + Number(t.amount), 0),
    }
  }, [tasks])

  const total = plan + fact

  const buildReport = () => {
    const line = '--------------------------------'
    const rows = (list) =>
      list.map((t) => `${t.title}: ${signed(Number(t.amount))} ₽`).join('\n')
    return [
      `${board.name} — Бюджет`,
      line,
      rows(doneEntries),
      planEntriesForReport(),
      line,
      `ПЛАН: ${signed(plan)} ₽`,
      `ФАКТ: ${signed(fact)} ₽`,
      `ИТОГО: ${signed(total)} ₽`,
    ]
      .filter(Boolean)
      .join('\n')

    function planEntriesForReport() {
      return entries
        .filter((t) => !DONE_LISTS.includes(t.list))
        .map((t) => `${t.title}: ${signed(Number(t.amount))} ₽`)
        .join('\n')
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildReport())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be unavailable — silent fallback
    }
  }

  return (
    <div className="space-y-4">
      {/* Итоги: план / факт / общий баланс */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">План</div>
          <div className="font-bold text-slate-800">{signed(plan)} ₽</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Факт</div>
          <div className="font-bold text-slate-800">{signed(fact)} ₽</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">ИТОГО</div>
          <div className="font-bold text-slate-800">{signed(total)} ₽</div>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">
          Задач с суммой пока нет — укажите сумму в форме задачи (доход или расход).
        </p>
      ) : (
        <div className="rounded border border-slate-200 divide-y divide-slate-100 max-h-64 overflow-y-auto">
          {/* финансовый вид: только знаки + и -, без цветовой дифференциации */}
          {entries.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
              <span className="truncate text-slate-700" title={t.title}>
                {t.title}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-slate-600">
                {signed(Number(t.amount))}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={copy}
        disabled={entries.length === 0}
        className="w-full bg-slate-600 text-white px-4 py-2 rounded hover:bg-slate-700 disabled:opacity-50 font-medium"
      >
        {copied ? 'Скопировано ✓' : 'Копировать'}
      </button>
    </div>
  )
}
