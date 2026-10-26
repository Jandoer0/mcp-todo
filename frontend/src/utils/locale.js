// Региональные настройки (ТЗ «Многоязычность» §2): формат даты и первый день
// недели. Это НЕ перевод текста, поэтому живёт вне i18next — но хранится и
// применяется вместе с языком (см. SettingsProvider).
//
// Все значения — ключи, как в профиле пользователя (User.date_format /
// first_day_of_week). Ключи, а не готовые строки: новый формат или язык не
// требует миграции данных.

// Форматы даты (ТЗ §2.А). Примеры — для 15 октября 2025.
export const DATE_FORMATS = [
  { key: 'eu', sample: '15.10.2025' },
  { key: 'us', sample: '10/15/2025' },
  { key: 'iso', sample: '2025-10-15' },
  { key: 'friendly', sample: '15 окт. 2025' },
]

// Первый день недели (ТЗ §2.Б).
export const WEEK_STARTS = ['monday', 'sunday']

const pad = (n) => String(n).padStart(2, '0')

// Тег локали для Intl-API (названия месяцев и др.). Язык интерфейса — это
// не то же самое, что формат даты: месяцы берём по языку, а порядок полей
// и разделители — по выбранному формату.
export const LOCALE_TAG = { ru: 'ru-RU', en: 'en-US' }

// «Friendly» использует короткое имя месяца — ключ в словаре перевода.
const MONTH_SHORT_KEYS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
]

/**
 * Разбор значения даты в {y, m, d, hh, mm}.
 *
 * Две семантики времени (см. utils/datetime.js):
 *  - момент события («когда») — Date, показывается в поясе просмотра;
 *  - плановая дата («сдать 26-го») — строка без пояса, читается как есть.
 * Здесь важен только календарный день, поэтому момент приводим к локальным
 * компонентам, а строку — к её собственным.
 */
export function dateParts(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null
    return {
      y: value.getFullYear(),
      m: value.getMonth() + 1,
      d: value.getDate(),
      hh: value.getHours(),
      mm: value.getMinutes(),
    }
  }
  const s = String(value)
  const [date, time = ''] = s.split('T')
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return null
  const [hh = 0, mm = 0] = time.split(':').map(Number)
  return { y, m, d, hh, mm }
}

/** Календарная дата по формату профиля: «15.10.2025» / «2025-10-15» / … */
export function formatDate(value, dateFormat = 'eu', t) {
  const p = dateParts(value)
  if (!p) return ''
  switch (dateFormat) {
    case 'us':
      return `${pad(p.m)}/${pad(p.d)}/${p.y}`
    case 'iso':
      return `${p.y}-${pad(p.m)}-${pad(p.d)}`
    case 'friendly':
      return `${p.d} ${t ? t(`months.short.${MONTH_SHORT_KEYS[p.m - 1]}`) : MONTH_SHORT_KEYS[p.m - 1]}. ${p.y}`
    case 'eu':
    default:
      return `${pad(p.d)}.${pad(p.m)}.${p.y}`
  }
}

/** Дата + время (моменты событий передавать уже разобранными через parseInstant). */
export function formatDateTime(value, dateFormat = 'eu', t) {
  const p = dateParts(value)
  if (!p) return ''
  return `${formatDate(value, dateFormat, t)} ${pad(p.hh)}:${pad(p.mm)}`
}

/**
 * Порядок дней недели в сетке календаря. Возвращает массив индексов
 * Date.getDay() (0 = воскресенье), начинающийся с первого дня недели профиля.
 */
export function weekdayOrder(firstDayOfWeek = 'monday') {
  return firstDayOfWeek === 'sunday'
    ? [0, 1, 2, 3, 4, 5, 6]
    : [1, 2, 3, 4, 5, 6, 0]
}

/** Ключи перевода шапки сетки в порядке weekdayOrder(). */
export function weekdayKeys(firstDayOfWeek = 'monday') {
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  return weekdayOrder(firstDayOfWeek).map((i) => keys[i])
}

/**
 * Сетка месяца: число ведущих пустых ячеек и количество дней.
 * Сдвиг зависит от первого дня недели (ТЗ §2.Б).
 */
export function monthGrid(monthDate, firstDayOfWeek = 'monday') {
  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const first = new Date(year, month, 1)
  const order = weekdayOrder(firstDayOfWeek)
  const leading = order.indexOf(first.getDay())
  const days = new Date(year, month + 1, 0).getDate()
  return { leading, days }
}
