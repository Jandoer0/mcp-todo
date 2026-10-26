// Даты и время: единые правила разбора. В приложении ДВЕ разные семантики
// времени, смешивать их нельзя — иначе время съезжает на смещение пояса,
// а календарный день «уедет» на сутки.
//
// 1) Моменты событий (created_at / changed_at / completed_at) — абсолютные
//    мгновения. Бэкенд хранит их наивным UTC без пояса («2026-10-26T07:40:00»,
//    см. backend/app/clock.py). JS трактует такие строки как ЛОКАЛЬНОЕ время,
//    поэтому показывалось 07:40 вместо 14:40. Добавляем «Z» при разборе и
//    отображаем в поясе просмотра (браузера).
//
// 2) Плановые даты (start_date / deadline / actual_date) — «стеновые часы»
//    пользователя и календарный день: «сдать 26-го до 23:59», «оплата 26-го».
//    Их нельзя сдвигать по часовому поясу: Планировщик и график бюджета
//    группируют события по дням, и сдвиг выбросил бы задачу на 25-е.
//    Поэтому они передаются строкой без пояса и читаются как есть.

const pad = (n) => String(n).padStart(2, '0')

const HAS_OFFSET = /([zZ]|[+-]\d{2}:?\d{2})$/

// Момент события → Date. Наивный ISO без пояса трактуем как UTC.
export function parseInstant(value) {
  if (!value) return null
  const s = String(value)
  const iso = HAS_OFFSET.test(s) ? s : s.includes('T') ? `${s}Z` : `${s}T00:00:00Z`
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

// Момент события → «26.10.2026 14:40» в поясе просмотра.
export function fmtInstant(value) {
  const d = parseInstant(value)
  if (!d) return '—'
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Локальный момент → строка без пояса «2026-10-26T14:40:00» — запись плановых
// дат (запоминает календарный день клиента, а не UTC-смещение).
export function toWallClock(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
}
