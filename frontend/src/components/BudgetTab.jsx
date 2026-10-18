import { useEffect, useMemo, useState } from 'react'
import { boardsApi, currenciesApi } from '../api/client'

// Мультивалютный бюджет (UPDATE ТЗ): итоги (ПЛАН/ФАКТ/ИТОГО) считаются в
// валюте расчёта доски (Decimal на бэкенде), записи показывают сумму в
// оригинальной валюте + эквивалент в валюте расчёта: «-10 000 RUB (≈ -110 USD)».

// 10000 → «10 000» (ru-RU uses non-breaking spaces as thousand separators)
function fmt(n) {
  return Math.abs(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

// Signed money: "-10 000" / "+20 000"
function signed(n) {
  return `${n < 0 ? '-' : '+'}${fmt(n)}`
}

export default function BudgetTab({ board, tasks = [], lists = [], onChanged }) {
  const [copied, setCopied] = useState(false)
  // Бюджет приходит с бэкенда (Decimal-расчёты, конверсия по курсам).
  const [budget, setBudget] = useState(null)
  const [currencies, setCurrencies] = useState([])
  const [saveError, setSaveError] = useState('')

  const loadBudget = () => {
    if (!board?.id) return
    boardsApi
      .budget(board.id)
      .then((res) => setBudget(res.data))
      .catch(() => setBudget(null))
  }

  useEffect(() => {
    loadBudget()
    currenciesApi
      .list()
      .then((res) => setCurrencies(res.data || []))
      .catch(() => setCurrencies([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id])

  // Валюта расчёта: id → объект (code/symbol) для подписей
  const reportCurrency = budget?.report_currency || null
  const reportCode = reportCurrency?.code || 'USD'

  // Смена валюты расчёта: сохраняем на доске и мгновенно пересчитываем
  const changeReportCurrency = async (id) => {
    setSaveError('')
    try {
      await boardsApi.update(board.id, { report_currency_id: id })
      loadBudget()
      onChanged?.()
    } catch (err) {
      setSaveError(err?.response?.data?.detail || 'Не удалось сохранить валюту расчёта')
    }
  }

  const entries = budget?.entries || []
  const doneNames = useMemo(
    () => new Set(lists.filter((l) => (l.kind || 'todo') === 'done').map((l) => l.name)),
    [lists],
  )
  // Фактические/плановые записи определяем по спискам доски (kind)
  const doneEntries = entries.filter((e) => doneNames.has(e.list))
  const plan = budget?.plan ?? 0
  const fact = budget?.fact ?? 0
  const income = budget?.income ?? 0
  const expense = budget?.expense ?? 0

  // Финансовый список: сначала задачи с ближайшим дедлайном, задачи без
  // дедлайна — в конце списка.
  const deadlineOf = (id) => tasks.find((t) => t.id === id)?.deadline || null
  const sortEntries = (list) =>
    [...list].sort((a, b) => {
      const da = deadlineOf(a.id) ? new Date(deadlineOf(a.id)).getTime() : Infinity
      const dbb = deadlineOf(b.id) ? new Date(deadlineOf(b.id)).getTime() : Infinity
      if (da !== dbb) return da - dbb
      return a.title.localeCompare(b.title, 'ru')
    })

  const total = plan + fact
  const incomeAbs = Math.abs(income)
  const expenseAbs = Math.abs(expense)
  const incomeSum = incomeAbs + expenseAbs

  // Строка записи: «Билеты: -10 000 RUB (≈ -110 USD)»
  const entryLine = (e) => {
    const orig = `${signed(e.amount)}${e.currency_code ? ` ${e.currency_code}` : ''}`
    const hasOwn = !!e.currency_code
    const conv =
      e.converted != null && (hasOwn || reportCode !== 'USD')
        ? ` (≈ ${signed(e.converted)} ${reportCode})`
        : ''
    return `${e.title}: ${orig}${conv}`
  }

  const buildReport = () => {
    const line = '--------------------------------'
    const planEntries = sortEntries(entries.filter((e) => !doneEntries.includes(e)))
    return [
      `${board.name} — Бюджет${reportCode ? ` (${reportCode})` : ''}`,
      line,
      sortEntries(doneEntries).map(entryLine).join('\n'),
      planEntries.map(entryLine).join('\n'),
      line,
      `ПЛАН: ${signed(plan)} ${reportCode}`,
      `ФАКТ: ${signed(fact)} ${reportCode}`,
      line,
      `ВСЕГО ДОХОД: ${signed(income)} ${reportCode}`,
      `ВСЕГО РАСХОД: ${signed(expense)} ${reportCode}`,
      `ИТОГО: ${signed(total)} ${reportCode}`,
    ]
      .filter((s) => s !== '')
      .join('\n')
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
      {/* Валюта расчёта: селектор + предупреждение о курсах */}
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 shrink-0">
          Валюта расчёта
        </label>
        <select
          value={reportCurrency?.id ?? ''}
          onChange={(e) => changeReportCurrency(e.target.value ? Number(e.target.value) : null)}
          className="p-1.5 border rounded text-sm"
        >
          {currencies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}
            </option>
          ))}
        </select>
      </div>
      {saveError && <p className="text-sm text-red-500">{saveError}</p>}
      {budget?.missing_rate && (
        <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          ⚠ У одной или нескольких валют не указан курс — обновите «Параметры валют», иначе итоги будут неполными.
        </p>
      )}

      {/* Сводный блок баланса: крупный итог + распределение доход/расход */}
      <div className="rounded-xl border border-slate-200 bg-card p-4 shadow-sm">
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
            {incomeAbs > 0 && <div className="bg-green-500" style={{ width: `${(incomeAbs / incomeSum) * 100}%` }} />}
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
          {/* финансовый вид: сумма в оригинальной валюте + эквивалент */}
          {sortEntries(entries).map((e) => {
            const dim = doneNames.has(e.list)
            return (
              <div key={e.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                <span className={`truncate ${dim ? 'text-slate-400' : 'text-slate-700'}`} title={e.title}>
                  {e.title}
                </span>
                <span className={`shrink-0 font-mono tabular-nums text-right ${dim ? 'text-slate-300' : 'text-slate-600'}`}>
                  {signed(e.amount)}
                  {e.currency_code && <span className="font-sans"> {e.currency_code}</span>}
                  {e.converted != null && (e.currency_code || reportCode !== 'USD') && (
                    <span className={`font-sans ${dim ? 'text-slate-200' : 'text-slate-400'}`}>
                      {' '}(≈ {signed(e.converted)} {reportCode})
                    </span>
                  )}
                </span>
              </div>
            )
          })}
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
