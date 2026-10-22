import { useEffect, useMemo, useState } from 'react'
import { boardsApi } from '../api/client'

// Мультивалютный бюджет (UPDATE ТЗ): итоги (ПЛАН/ФАКТ/ИТОГО) считаются в
// валюте расчёта доски (Decimal на бэкенде), записи показывают сумму в
// оригинальной валюте + эквивалент в валюте расчёта: «-10 000 RUB (≈ -110 USD)».
// Вложена в BudgetView (ТЗv2 §4): данные и селектор валюты расчёта живут
// в оболочке; при внешнем `data` вкладка не грузит ничего сама.

// 10000 → «10 000» (ru-RU uses non-breaking spaces as thousand separators)
function fmt(n) {
  return Math.abs(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

// Signed money: "-10 000" / "+20 000"
function signed(n) {
  return `${n < 0 ? '-' : '+'}${fmt(n)}`
}

export default function BudgetTab({ board, tasks = [], lists = [], data: externalBudget = null }) {
  const [copied, setCopied] = useState(false)
  // Бюджет приходит с бэкенда (Decimal-расчёты, конверсия по курсам).
  // В BudgetView данные загружаются снаружи (общий загрузчик с графиком);
  // автономная загрузка сохранена как fallback для прямого использования.
  const [ownBudget, setOwnBudget] = useState(null)

  useEffect(() => {
    if (externalBudget || !board?.id) return
    boardsApi
      .budget(board.id)
      .then((res) => setOwnBudget(res.data))
      .catch(() => setOwnBudget(null))
  }, [board?.id, externalBudget])

  const budget = externalBudget ?? ownBudget

  // Валюта расчёта: id → объект (code/symbol) для подписей
  const reportCurrency = budget?.report_currency || null
  const reportCode = reportCurrency?.code || 'USD'

  // Смена валюты расчёта и селектор — в оболочке BudgetView (ТЗv2 §4.4)

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

  // Строка записи: сумма только в валюте расчёта («Билеты: -110»);
  // без курса — исходная сумма с кодом валюты (см. предупреждение выше).
  const entryLine = (e) => {
    const value =
      e.converted != null ? signed(e.converted) : `${signed(e.amount)}${e.currency_code ? ` ${e.currency_code}` : ''}`
    return `${e.title}: ${value}`
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
      {budget?.missing_rate && (
        <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          ⚠ У одной или нескольких валют не указан курс — обновите «Параметры валют», иначе итоги будут неполными.
        </p>
      )}

      {/* Сводный блок баланса — мобильный: «чек-выписка» (вертикальные строки
          с точечными лидерами — цифры не наезжают друг на друга при любой длине) */}
      <div className="md:hidden rounded-xl border border-slate-200 bg-card p-4 shadow-sm space-y-3">
        {/* Герой: общий баланс крупно по центру */}
        <div className="rounded-lg bg-slate-50 py-3 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Баланс доски
          </div>
          <div
            className={`text-3xl font-extrabold tabular-nums leading-tight ${
              total > 0 ? 'text-green-600' : total < 0 ? 'text-red-600' : 'text-slate-800'
            }`}
          >
            {signed(total)}
          </div>
          {reportCode && (
            <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              {reportCode}
            </div>
          )}
        </div>

        {/* Полоса распределения доход/расход */}
        <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
          {incomeAbs > 0 && <div className="bg-green-500" style={{ width: `${(incomeAbs / incomeSum) * 100}%` }} />}
          {expenseAbs > 0 && <div className="bg-red-500" style={{ width: `${(expenseAbs / incomeSum) * 100}%` }} />}
        </div>

        {/* Строки-выписка: метка ······ значение (чек-стиль) */}
        <div className="space-y-2">
          {[
            { label: 'Доходы', value: income, dot: 'bg-green-500', text: 'text-green-600' },
            { label: 'Расходы', value: expense, dot: 'bg-red-500', text: 'text-red-600' },
            { label: 'План', value: plan, dot: 'bg-slate-300', text: 'text-slate-800' },
            { label: 'Факт', value: fact, dot: 'bg-slate-400', text: 'text-slate-800' },
            { label: 'Базовый слой', value: budget?.regular ?? 0, dot: 'bg-teal-500', text: 'text-teal-700' },
          ].map((row) => (
            <div key={row.label} className="flex items-baseline gap-2 text-sm">
              <span className={`h-2 w-2 shrink-0 rounded-full ${row.dot}`} />
              <span className="shrink-0 text-slate-500">{row.label}</span>
              <span className="min-w-4 flex-1 border-b border-dotted border-slate-200" />
              <span className={`shrink-0 font-bold tabular-nums ${row.text}`}>{signed(row.value)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Сводный блок баланса — десктоп: план / баланс / факт в строку */}
      <div className="hidden md:block rounded-xl border border-slate-200 bg-card p-4 shadow-sm">
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
          {/* Базовый слой: регулярные платежи vs разовые операционные */}
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-2">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-teal-500" />
              Базовый слой (регулярные)
            </span>
            <span className="tabular-nums font-semibold text-teal-700">
              {signed(budget?.regular ?? 0)}
              <span className="text-slate-400 font-normal"> · разовые: {signed(budget?.operational ?? 0)}</span>
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
          {/* финансовый вид: суммы в валюте расчёта доски; регулярные платежи
              (список «Регулярные») помечены как «базовый слой» */}
          {sortEntries(entries).map((e) => {
            const dim = doneNames.has(e.list)
            return (
              <div key={e.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                <span className={`truncate ${dim ? 'text-slate-400' : 'text-slate-700'}`} title={e.title}>
                  {e.is_regular && (
                    <span
                      className="inline-block align-middle mr-1.5 rounded px-1 text-[9px] font-bold uppercase bg-teal-100 text-teal-700"
                      title="Регулярный платёж — базовый слой бюджета"
                    >
                      базовый
                    </span>
                  )}
                  {e.title}
                </span>
                <span className={`shrink-0 font-mono tabular-nums text-right ${dim ? 'text-slate-300' : 'text-slate-600'}`}>
                  {e.converted != null ? signed(e.converted) : signed(e.amount)}
                  {e.converted == null && e.currency_code && (
                    <span className="font-sans" title="Курс не указан"> {e.currency_code} ⚠</span>
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
