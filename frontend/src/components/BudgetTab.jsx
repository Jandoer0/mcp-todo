import { useMemo, useState } from 'react'

// Property-based budgeting (UPDATE ТЗ): списки со свойством kind='done' дают
// ФАКТ, остальные (todo/progress) — ПЛАН. ИТОГО — все суммы доски.

// 10000 → «10 000» (ru-RU uses non-breaking spaces as thousand separators)
function fmt(n) {
  return Math.abs(n).toLocaleString('ru-RU')
}

// Signed money without currency: "-10 000" / "+20 000"
function signed(n) {
  return `${n < 0 ? '-' : '+'}${fmt(n)}`
}

export default function BudgetTab({ board, tasks = [], lists = [] }) {
  const [copied, setCopied] = useState(false)

  const { plan, fact, entries, doneEntries, doneNames, income, expense } = useMemo(() => {
    const doneNames = new Set(
      lists.filter((l) => (l.kind || 'todo') === 'done').map((l) => l.name),
    )
    const entries = tasks.filter((t) => (Number(t.amount) || 0) !== 0)
    const doneEntries = entries.filter((t) => doneNames.has(t.list))
    const fact = doneEntries.reduce((s, t) => s + Number(t.amount), 0)
    const total = entries.reduce((s, t) => s + Number(t.amount), 0)
    const income = entries
      .filter((t) => Number(t.amount) > 0)
      .reduce((s, t) => s + Number(t.amount), 0)
    const expense = entries
      .filter((t) => Number(t.amount) < 0)
      .reduce((s, t) => s + Number(t.amount), 0)
    return { entries, doneEntries, doneNames, plan: total - fact, fact, income, expense }
  }, [tasks, lists])

  // Финансовый список: сначала задачи с ближайшим дедлайном, задачи без
  // дедлайна — в конце списка.
  const sortEntries = (list) =>
    [...list].sort((a, b) => {
      const da = a.deadline ? new Date(a.deadline).getTime() : Infinity
      const db = b.deadline ? new Date(b.deadline).getTime() : Infinity
      if (da !== db) return da - db
      return a.title.localeCompare(b.title, 'ru')
    })

  const total = plan + fact
  const incomeSum = Math.abs(income) + Math.abs(expense)
  const expenseAbs = Math.abs(expense)

  const buildReport = () => {
    const line = '--------------------------------'
    const rows = (list) =>
      list.map((t) => `${t.title}: ${signed(Number(t.amount))}`).join('\n')
    return [
      `${board.name} — Бюджет`,
      line,
      rows(sortEntries(doneEntries)),
      planEntriesForReport(),
      line,
      `ПЛАН: ${signed(plan)}`,
      `ФАКТ: ${signed(fact)}`,
      line,
      `ВСЕГО ДОХОД: ${signed(income)}`,
      `ВСЕГО РАСХОД: ${signed(expense)}`,
      `ИТОГО: ${signed(total)}`,
    ]
      .filter(Boolean)
      .join('\n')

    function planEntriesForReport() {
      return sortEntries(entries.filter((t) => !doneEntries.includes(t)))
        .map((t) => `${t.title}: ${signed(Number(t.amount))}`)
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
      {/* Сводный блок баланса: крупный итог + распределение доход/расход */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {/* План / Баланс / Факт — одна строка */}
        <div className="grid grid-cols-3 items-center divide-x divide-slate-100 rounded-lg bg-slate-50 py-2 text-center">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">План</div>
            <div className="font-bold tabular-nums text-slate-800">{signed(plan)}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Баланс доски</div>
            <div
              className={`text-xl font-extrabold tabular-nums ${
                total > 0 ? 'text-green-600' : total < 0 ? 'text-red-600' : 'text-slate-800'
              }`}
            >
              {signed(total)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Факт</div>
            <div className="font-bold tabular-nums text-slate-800">{signed(fact)}</div>
          </div>
        </div>

        {/* Полоса распределения доход/расход */}
        <div className="mt-3">
          <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
            {incomeSum > 0 && <div className="bg-green-500" style={{ width: `${(income / incomeSum) * 100}%` }} />}
            {expenseAbs > 0 && <div className="bg-red-500" style={{ width: `${(expenseAbs / incomeSum) * 100}%` }} />}
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-slate-500">Доходы</span>
              <span className="font-bold tabular-nums text-green-600">{signed(income)}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-slate-500">Расходы</span>
              <span className="font-bold tabular-nums text-red-600">{signed(expense)}</span>
              <span className="h-2 w-2 rounded-full bg-red-500" />
            </span>
          </div>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">
          Задач с суммой пока нет — укажите сумму в форме задачи (доход или расход).
        </p>
      ) : (
        <div className="rounded border border-slate-200 divide-y divide-slate-100 max-h-[min(33rem,50dvh)] overflow-y-auto">
          {/* финансовый вид: только знаки + и -, без цветовой дифференциации */}
          {sortEntries(entries).map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
              <span
                className={`truncate ${doneNames.has(t.list) ? 'text-slate-400' : 'text-slate-700'}`}
                title={t.title}
              >
                {t.title}
              </span>
              <span
                className={`shrink-0 font-mono tabular-nums ${doneNames.has(t.list) ? 'text-slate-300' : 'text-slate-600'}`}
              >
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
