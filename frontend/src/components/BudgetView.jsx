import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { boardsApi, currenciesApi } from '../api/client'
import BudgetTab from './BudgetTab'
import ChartTab from './ChartTab'

// Оболочка объединённой вкладки «Бюджет» (ТЗv2 §4): один переключатель
// «Итоги ↔ График», общий загрузчик (budget + cashflow одним Promise.all —
// переключение режимов мгновенное и без дублирующих запросов) и единый
// селектор валюты расчёта доски, действующий в обоих режимах.
// Содержимое режимов — прежние BudgetTab/ChartTab, переиспользованные как есть.

const MODES = [
  { id: 'totals', labelKey: 'budget.tabTotals' },
  { id: 'chart', labelKey: 'budget.tabChart' },
]

// Выбранный режим запоминается между открытиями (localStorage).
const MODE_KEY = 'budgetViewMode'

function initialMode() {
  try {
    return localStorage.getItem(MODE_KEY) === 'chart' ? 'chart' : 'totals'
  } catch {
    return 'totals'
  }
}

export default function BudgetView({ board, tasks = [], lists = [], onChanged }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState(initialMode)
  const [budget, setBudget] = useState(null)
  const [cashflow, setCashflow] = useState(null)
  const [currencies, setCurrencies] = useState([])
  const [saveError, setSaveError] = useState('')

  // Общий загрузчик: бюджет и график запрашиваются параллельно; при смене
  // валюты расчёта просто перезапускаем его — оба режима сразу пересчитываются.
  const reload = useCallback(() => {
    if (!board?.id) return
    Promise.allSettled([boardsApi.budget(board.id), boardsApi.cashflow(board.id)]).then(
      ([b, c]) => {
        setBudget(b.status === 'fulfilled' ? b.value.data : null)
        setCashflow(c.status === 'fulfilled' ? c.value.data : null)
      },
    )
  }, [board?.id])

  useEffect(() => {
    reload()
  }, [reload])

  // Валюты пользователя — для селектора валюты расчёта (один раз на доску).
  useEffect(() => {
    currenciesApi.list().then((r) => setCurrencies(r.data || [])).catch(() => setCurrencies([]))
  }, [board?.id])

  const changeMode = (id) => {
    setMode(id)
    try {
      localStorage.setItem(MODE_KEY, id)
    } catch {
      // localStorage может быть недоступен — режим просто не запомнится
    }
  }

  // Смена валюты расчёта: сохраняем на доске и пересчитываем оба режима.
  const changeReportCurrency = async (id) => {
    setSaveError('')
    try {
      await boardsApi.update(board.id, { report_currency_id: id })
      reload()
      onChanged?.()
    } catch (err) {
      setSaveError(err?.response?.data?.detail || t('budget.saveCurrencyError'))
    }
  }

  return (
    <div className="space-y-4">
      {/* Переключатель режимов в стиле табов приложения: активный — подчёркнут */}
      <div className="flex gap-1 border-b border-slate-200">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => changeMode(m.id)}
            className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              mode === m.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t(m.labelKey)}
          </button>
        ))}
      </div>

      {/* Валюта расчёта: одна на всю вкладку, действует и в итогах, и в графике */}
      <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {t('budget.reportCurrency')}
        </span>
        <select
          value={budget?.report_currency?.id ?? ''}
          onChange={(e) => changeReportCurrency(e.target.value ? Number(e.target.value) : null)}
          className="bg-transparent border-0 p-0 text-sm font-semibold text-slate-700 cursor-pointer outline-none focus:ring-0"
        >
          {currencies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}
            </option>
          ))}
        </select>
      </div>
      {saveError && <p className="text-sm text-red-500">{saveError}</p>}

      {/* Содержимое режима: прежние вкладки, данные — из общего загрузчика */}
      {mode === 'chart' ? (
        <ChartTab board={board} data={cashflow} />
      ) : (
        <BudgetTab board={board} tasks={tasks} lists={lists} data={budget} />
      )}
    </div>
  )
}
