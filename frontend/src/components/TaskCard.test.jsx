import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../i18n/index.js'  // инициализация i18next (дефолтный язык ru)
import { SettingsProvider } from '../i18n/settings.jsx'
import TaskCard from './TaskCard'

// API не должен дёргаться в тестах — мокаем клиент целиком.
vi.mock('../api/client', () => ({ tasksApi: {} }))

// TaskCard читает язык/регион через useSettings — нужен провайдер.
const renderCard = (ui) => render(<SettingsProvider>{ui}</SettingsProvider>)

const currencies = [
  { id: 1, code: 'RUB', symbol: '₽' },
  { id: 2, code: 'USD', symbol: '$' },
]

const lists = [
  { id: 1, name: 'Не начато', kind: 'todo', position: 1, color: '#64748b' },
  { id: 2, name: 'Готово', kind: 'done', position: 2, color: '#22c55e' },
]

const baseTask = {
  id: 1,
  title: 'Аренда',
  priority: 2,
  list: 'Не начато',
  amount: 10000,
  currency_id: 1,
  tags: [],
  blocked_by: [],
}

describe('TaskCard — бейдж суммы (§3)', () => {
  it('доход: сокращённая сумма + знак + символ валюты задачи', () => {
    renderCard(<TaskCard task={baseTask} lists={lists} currencies={currencies} />)
    expect(screen.getByText('+10 тыс. ₽')).toBeInTheDocument()
  })

  it('в подсказке — полное значение суммы', () => {
    renderCard(<TaskCard task={baseTask} lists={lists} currencies={currencies} />)
    // title = «Сумма: <полная> <валюта>», цифры разделены \u00a0 в ru-RU.
    const title = screen.getByText('+10 тыс. ₽').getAttribute('title')
    expect(title.replace(/[\u00a0\u202f]/g, ' ')).toBe('Сумма: +10 000 ₽')
  })

  it('расход: минус и красный цвет (в отличие от дохода amber)', () => {
    renderCard(
      <TaskCard
        task={{ ...baseTask, amount: -1200, currency_id: 2 }}
        lists={lists}
        currencies={currencies}
      />,
    )
    const el = screen.getByText('−1,2 тыс. $')
    expect(el).toBeInTheDocument()
    expect(el.className).toContain('text-red-500')
  })

  it('нулевая сумма — бейджа нет', () => {
    renderCard(<TaskCard task={{ ...baseTask, amount: 0 }} lists={lists} currencies={currencies} />)
    expect(screen.queryByText(/\d.*₽/)).not.toBeInTheDocument()
  })
})
