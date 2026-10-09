import { useState, useMemo } from 'react'

const FALLBACK_COLOR = '#64748b'

export default function TagInput({ value = [], availableTags = [], onChange }) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)

  const colorMap = useMemo(() => {
    const m = {}
    for (const t of availableTags) m[t.name] = t.color
    return m
  }, [availableTags])

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase()
    return availableTags.filter(
      (t) => t.name.toLowerCase().includes(q) && !value.includes(t.name),
    )
  }, [input, availableTags, value])

  const addTag = (raw) => {
    const name = (raw || '').trim()
    if (!name || value.includes(name)) {
      setInput('')
      setOpen(false)
      return
    }
    onChange([...value, name])
    setInput('')
    setOpen(false)
  }

  const removeTag = (name) => onChange(value.filter((v) => v !== name))

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag(input)
    } else if (e.key === 'Backspace' && !input && value.length) {
      removeTag(value[value.length - 1])
    }
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-2 p-2 border rounded dark:bg-gray-700 min-h-[42px]">
        {value.map((name) => {
          const color = colorMap[name] || FALLBACK_COLOR
          return (
            <span
              key={name}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-white truncate max-w-full"
              style={{ backgroundColor: color }}
            >
              {name}
              <button
                type="button"
                onClick={() => removeTag(name)}
                className="text-white/80 hover:text-white leading-none text-xs"
                aria-label={`Удалить тег ${name}`}
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
          placeholder={value.length ? '' : 'Введите тег и нажмите Enter'}
          className="flex-1 min-w-[8rem] bg-transparent outline-none py-0.5"
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border rounded shadow max-h-48 overflow-auto">
          {suggestions.map((t) => (
            <li key={t.id ?? t.name}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  addTag(t.name)
                }}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: t.color }}
                />
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
