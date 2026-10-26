import { describe, it, expect } from 'vitest'
import { parseInstant, fmtInstant, toWallClock } from './datetime'

// Регрессия: бэкенд отдаёт наивный UTC без пояса, JS принимал его за локальное
// время — «Задача выполнена» съезжала на смещение пояса (07:40 вместо 14:40).
describe('parseInstant (моменты событий)', () => {
  it('наивный ISO трактуется как UTC', () => {
    const naive = parseInstant('2026-10-26T07:40:00')
    const utc = parseInstant('2026-10-26T07:40:00Z')
    expect(naive).not.toBeNull()
    expect(naive.getTime()).toBe(utc.getTime())
  })

  it('строка с явным смещением не дублируется', () => {
    expect(parseInstant('2026-10-26T07:40:00+07:00').getTime()).toBe(
      parseInstant('2026-10-26T00:40:00Z').getTime(),
    )
  })

  it('мусор не роняет форматтер', () => {
    expect(parseInstant('')).toBeNull()
    expect(parseInstant('не дата')).toBeNull()
    expect(fmtInstant('не дата')).toBe('—')
    expect(fmtInstant('')).toBe('—')
  })
})

describe('toWallClock (плановые даты)', () => {
  it('сохраняет календарный день и время клиента, без пояса', () => {
    expect(toWallClock(new Date(2026, 9, 26, 14, 40))).toBe('2026-10-26T14:40:00')
  })

  it('содержит время — иначе разбор плановых дат уедет на сутки', () => {
    expect(toWallClock(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01T00:05:00')
  })
})
