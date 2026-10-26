import i18n from '../i18n/index.js'

// Общие форматтеры денежных сумм (ТЗv2 §5.6): единая точка для карточек,
// форм и бюджета — регрессии §2–3 проще ловить тестами на чистые функции.
//
// Локаль чисел берётся из i18n (язык интерфейса), а не из браузера: сумма
// должна выглядеть так же, как весь остальной текст интерфейса. Теги:
// ru-RU — разделитель групп «10 000» (nbsp), en-US — «10,000» (запятая).

const numberLocale = () => (i18n.language === 'en' ? 'en-US' : 'ru-RU')

// Локаль для toLocaleString в других компонентах (суммы в истории и т.п.).
export { numberLocale }

// «-10000» → «-10 000» (знак всегда, для маркеров и подсказок)
export function formatAmount(v) {
  const n = Number(v) || 0
  const sign = n < 0 ? '-' : '+'
  return `${sign}${Math.abs(n).toLocaleString(numberLocale())}`
}

// Signed money без пробела: "+20 000" / "-10 000" (бюджет, график)
export function signedAmount(n) {
  return `${n < 0 ? '-' : '+'}${Math.abs(n).toLocaleString(numberLocale(), { maximumFractionDigits: 2 })}`
}

// Крупные суммы сокращаем для компактной карточки: 4 200 → «4,2 тыс.» / «4.2k»,
// 12 500 000 → «12,5 млн» / «12.5M». Суффикс — из словаря (money.thousand /
// money.million), разделитель дробей — по локали чисел.
export function compactAmount(value) {
  const loc = numberLocale()
  const abs = Math.abs(value)
  if (abs >= 999_950)
    return `${(abs / 1_000_000).toLocaleString(loc, { maximumFractionDigits: 1 })} ${i18n.t('money.million')}`
  if (abs >= 1_000)
    return `${(abs / 1_000).toLocaleString(loc, { maximumFractionDigits: 1 })} ${i18n.t('money.thousand')}`
  return abs.toLocaleString(loc)
}

// Символ валюты для суммы на карточке (ТЗv2 §3): валюта задачи, а при
// отсутствии валюты — первая валюта пользователя (валюта по умолчанию).
export function currencySymbol(task, currencies = []) {
  const own = currencies.find((c) => c.id === task?.currency_id)
  const fallback = currencies[0]
  return (own || fallback)?.symbol || (own || fallback)?.code || ''
}
