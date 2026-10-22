// Общие форматтеры денежных сумм (ТЗv2 §5.6): единая точка для карточек,
// форм и бюджета — регрессии §2–3 проще ловить тестами на чистые функции.

// «-10000» → «-10 000» (знак всегда, для маркеров и подсказок)
export function formatAmount(v) {
  const n = Number(v) || 0
  const sign = n < 0 ? '-' : '+'
  return `${sign}${Math.abs(n).toLocaleString('ru-RU')}`
}

// Signed money без пробела: "+20 000" / "-10 000" (бюджет, график)
export function signedAmount(n) {
  return `${n < 0 ? '-' : '+'}${Math.abs(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`
}

// Крупные суммы сокращаем для компактной карточки: 4 200 → 4,2 тыс.,
// 12 500 000 → 12,5 млн. Полное значение остаётся в title и в форме задачи.
export function compactAmount(value) {
  const abs = Math.abs(value)
  if (abs >= 999_950) return `${(abs / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`
  if (abs >= 1_000) return `${(abs / 1_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} тыс.`
  return abs.toLocaleString('ru-RU')
}

// Символ валюты для суммы на карточке (ТЗv2 §3): валюта задачи, а при
// отсутствии валюты — первая валюта пользователя (валюта по умолчанию).
export function currencySymbol(task, currencies = []) {
  const own = currencies.find((c) => c.id === task?.currency_id)
  const fallback = currencies[0]
  return (own || fallback)?.symbol || (own || fallback)?.code || ''
}
