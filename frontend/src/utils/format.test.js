import { describe, it, expect } from 'vitest'
import { compactAmount, currencySymbol, formatAmount } from './format'

// toLocaleString в разных ICU разделяет цифры \u00a0 / \u202f — нормализуем.
const nb = (s) => String(s).replace(/[\u00a0\u202f]/g, ' ')

describe('formatAmount (§3)', () => {
  it('всегда ставит знак и разделяет тысячи', () => {
    expect(nb(formatAmount(10000))).toBe('+10 000')
    expect(nb(formatAmount(-1200))).toBe('-1 200')
    expect(formatAmount(0)).toBe('+0')
  })
})

describe('compactAmount (§3.3)', () => {
  it('сокращает тысячи и миллионы, русская локаль', () => {
    expect(compactAmount(4200)).toBe('4,2 тыс.')
    expect(compactAmount(12500000)).toBe('12,5 млн')
    expect(compactAmount(999)).toBe('999')
  })

  it('не превращает 999 999 в «1000 тыс.»', () => {
    expect(compactAmount(999999)).toBe('1 млн')
  })

  it('для расходов сокращает модуль (знак ставит карточка)', () => {
    expect(compactAmount(-1200)).toBe('1,2 тыс.')
  })
})

describe('currencySymbol (§3.1)', () => {
  const currencies = [
    { id: 1, code: 'RUB', symbol: '₽' },
    { id: 2, code: 'USD', symbol: '$' },
  ]

  it('берёт символ валюты задачи', () => {
    expect(currencySymbol({ currency_id: 2 }, currencies)).toBe('$')
  })

  it('без валюты у задачи — валюта по умолчанию (первая)', () => {
    expect(currencySymbol({ currency_id: null }, currencies)).toBe('₽')
    expect(currencySymbol({}, currencies)).toBe('₽')
  })

  it('без валют вообще — пустая строка', () => {
    expect(currencySymbol({}, [])).toBe('')
  })
})
