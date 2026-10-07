import { useState, useMemo } from 'react'

const STATUS_LABEL = {
  todo: 'Не начато',
  in_progress: 'В работе',
  done: 'Готово',
}

export default function TaskLinkInput({ value = [], tasks = [], excludeId, onChange }) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)

  const byId = useMemo(() => {
    const m = {}
    for (const t of tasks) m[t.id] = t
    return m
  }, [tasks])

  const selectedSet = useMemo(() => new Set(value), [value])

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase()
    const pool = tasks.filter(
      (t) => t.id !== excludeId && !selectedSet.has(t.id),
    )
    const filtered = q
      ? pool.filter((t) => t.title.toLowerCase().includes(q))
      : pool
    return filtered.slice(0, 8)
  }, [input, tasks, excludeId, selectedSet])

  const addTask = (task) => {
    if (!task || selectedSet.has(task.id) || task.id === excludeId) {
      setInput('')
      setOpen(false)
      return
    }
    onChange([...value, task.id])
    setInput('')
    setOpen(false)
  }

  const addByText = (raw) => {
    const name = (raw || '').trim().toLowerCase()
    if (!name) return
    const match = suggestions.find((t) => t.title.toLowerCase() === name) || suggestions[0]
    addTask(match)
  }

  const removeTask = (id) => onChange(value.filter((v) => v !== id))

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addByText(input)
    } else if (e.key === 'Backspace' && !input && value.length) {
      removeTask(value[value.length - 1])
    }
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-2 p-2 border rounded dark:bg-gray-700 min-h-[42px]">
        {value.map((id) => {
          const t = byId[id]
          if (!t) return null
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-200 text-gray-800 dark:bg-gray-600 dark:text-gray-100 text-sm"
            >
              {t.title}
              <button
                type="button"
                onClick={() => removeTask(id)}
                className="text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white leading-none"
                aria-label={`Убрать блокирующую задачу ${t.title}`}
              >
                ×
              </button>
            </span>
          )
        })}
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder={value.length ? '' : 'Введите название задачи'}
          className="flex-1 min-w-[8rem] bg-transparent outline-none py-0.5"
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border rounded shadow max-h-56 overflow-auto">
          {suggestions.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  addTask(t)
                }}
                className="w-full text-left px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <span className="truncate">{t.title}</span>
                <span className="text-[11px] text-gray-500 flex-shrink-0">
                  {STATUS_LABEL[t.status] || t.list || ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
