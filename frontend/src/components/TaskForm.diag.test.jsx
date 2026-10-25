import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import TaskForm from './TaskForm'

// Диагностический тест: воспроизводит React error #130 («Element type is
// invalid: got object») при открытии диалога задачи. В dev-режиме vitest
// сообщение ошибки НЕ минифицировано — в нём будет имя компонента.

vi.mock('../api/client', () => ({
  tasksApi: { changes: vi.fn(() => Promise.resolve({ data: [] })) },
  currenciesApi: { list: vi.fn(() => Promise.resolve({ data: [] })) },
}))

const lists = [
  { id: 1, name: 'Регулярные', kind: 'regular', position: 1, color: '#8b5cf6' },
  { id: 2, name: 'Не начато', kind: 'todo', position: 2, color: '#64748b' },
  { id: 3, name: 'В работе', kind: 'progress', position: 3, color: '#3b82f6' },
  { id: 4, name: 'Готово', kind: 'done', position: 4, color: '#22c55e' },
  { id: 5, name: 'Архив', kind: 'done', position: 5, color: '#94a3b8' },
]

const baseTask = {
  id: 42,
  title: 'Аренда офиса',
  description: '- [ ] пункт 1\n- [x] пункт 2',
  priority: 2,
  list: 'Не начато',
  amount: -10000,
  currency_id: 1,
  board_id: 7,
  tags: [{ name: 'т1', color: '#f00' }],
  blocked_by: [],
}

describe('TaskForm — диагностика #130', () => {
  it('редактирование существующей задачи рендерится без ошибок', () => {
    let error = null
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      const msg = args.map(String).join(' ')
      if (msg.includes('Element type is invalid') || msg.includes('Minified React error #130')) {
        error = msg
      }
    })
    try {
      render(
        <TaskForm
          open
          onClose={() => {}}
          onSubmit={() => {}}
          task={baseTask}
          tasks={[baseTask]}
          lists={lists}
          tags={[{ id: 1, name: 'т1', color: '#f00' }]}
          boards={[{ id: 7, name: 'Моя доска' }]}
          defaultBoardId={7}
        />,
      )
    } finally {
      spy.mockRestore()
    }
    expect(error).toBeNull()
  })

  it('создание новой задачи рендерится без ошибок', () => {
    let error = null
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      const msg = args.map(String).join(' ')
      if (msg.includes('Element type is invalid') || msg.includes('Minified React error #130')) {
        error = msg
      }
    })
    try {
      render(
        <TaskForm
          open
          onClose={() => {}}
          onSubmit={() => {}}
          tasks={[]}
          lists={lists}
          tags={[]}
          boards={[{ id: 7, name: 'Моя доска' }]}
          defaultBoardId={7}
        />,
      )
    } finally {
      spy.mockRestore()
    }
    expect(error).toBeNull()
  })
})
