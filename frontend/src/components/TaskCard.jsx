import { useState } from 'react'

function formatDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ArrowDown() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function ArrowUp() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
    </svg>
  )
}

function Trash() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

// Radio-style circle button of the side segments.
function RadioBtn({ onClick, disabled, title, danger, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center justify-center w-11 py-3 ${
        disabled
          ? 'opacity-30 cursor-not-allowed'
          : danger
            ? 'text-red-500 hover:bg-red-50'
            : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  )
}

function RadioCircle() {
  return <span className="w-4 h-4 rounded-full border-2 border-current" />
}

export default function TaskCard({ task, allTasks = [], lists = [], tags = [], onSetList, onEdit, onDelete }) {
  // Lists are ordered by position; movement goes to the adjacent (neighbor) list
  // so a card never "jumps" over a column.
  const ordered = [...lists].sort((a, b) => a.position - b.position)
  const idx = ordered.findIndex((l) => l.name === task.list)
  const nextList = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null
  const prevList = idx > 0 ? ordered[idx - 1] : null
  const isFirst = idx === 0
  const isLast = idx === ordered.length - 1

  // Priority dot color: 1 Low (Grey), 2 Medium (Blue), 3 High (Red)
  const priorityDot = {
    1: 'bg-slate-400',
    2: 'bg-blue-500',
    3: 'bg-red-500',
  }[task.priority || 2]

  const moveTo = (targetName) => {
    if (targetName === 'Готово' && task.is_blocked) {
      alert('Сначала выполните блокирующие задачи')
      return
    }
    onSetList(task, targetName)
  }

  const handleDelete = () => {
    if (confirm(`Удалить задачу «${task.title}»?`)) onDelete(task)
  }

  const overdue = task.deadline && new Date(task.deadline) < new Date()

  return (
    <div className="flex items-stretch bg-white rounded-md shadow-sm overflow-hidden">
      {/* Left segment: radio — move to the NEXT (lower) list; in «Архив» (last) — Delete */}
      {isLast ? (
        <RadioBtn onClick={handleDelete} title="Удалить задачу" danger>
          <Trash />
        </RadioBtn>
      ) : (
        <RadioBtn
          onClick={() => nextList && moveTo(nextList.name)}
          disabled={!nextList}
          title={nextList ? `Переместить в «${nextList.name}»` : 'Это последний список'}
        >
          <RadioCircle />
        </RadioBtn>
      )}

      {/* Middle segment: open editor */}
      <div onClick={() => onEdit(task)} className="flex-1 min-w-0 py-2 px-2 cursor-pointer">
        {/* Line 1: title, bold, single line */}
        <div
          className="font-bold truncate text-sm text-slate-800 flex items-center gap-1.5"
          title={task.title}
        >
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${priorityDot}`}
            title={task.priority === 3 ? 'Высокий приоритет' : task.priority === 1 ? 'Низкий приоритет' : 'Средний приоритет'}
          />
          <span className="truncate">{task.title}</span>
        </div>

        {/* Line 2: description, single line, italic allowed */}
        {task.description && (
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-1 break-words italic">
            {task.description}
          </p>
        )}

        {/* Line 3: start date (left) / deadline (right, red when overdue) */}
        <div className="flex items-center justify-between gap-2 mt-1.5 text-[11px] font-bold text-slate-600">
          <div className="truncate">{task.start_date && formatDate(task.start_date)}</div>
          <div className={`truncate ${overdue ? 'text-red-500' : ''}`}>
            {task.deadline && formatDate(task.deadline)}
          </div>
        </div>

        {/* Line 4: tags, centered, single line — only fully fitting tags are visible */}
        {(task.tags || []).length > 0 && (
          <div className="mt-1 overflow-hidden">
            <div className="flex justify-center gap-1 whitespace-nowrap">
              {(task.tags || []).map((t, i) => {
                const name = typeof t === 'string' ? t : (t.name || t)
                const tagData = tags.find((tag) => tag.name === name)
                const color = tagData ? tagData.color : '#64748b'
                return (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white shrink-0"
                    style={{ backgroundColor: color }}
                    title={name}
                  >
                    {name}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* Line 5: blocking tasks, centered, single line — only fully fitting are visible */}
        {(task.is_blocked || (task.blocked_by && task.blocked_by.length > 0)) && (
          <div className="mt-1 overflow-hidden">
            <div className="flex justify-center gap-1 whitespace-nowrap">
              {(task.blocked_by || []).map((bid) => {
                const bTask = allTasks.find((t) => t.id === bid)
                return (
                  <span
                    key={bid}
                    className="px-1 rounded bg-slate-100 border border-slate-300 text-[10px] text-slate-600 shrink-0"
                  >
                    {bTask ? bTask.title : bid}
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Right segment: radio — move to the PREVIOUS (upper) list; in «Не начато» (first) — Delete */}
      {isFirst ? (
        <RadioBtn onClick={handleDelete} title="Удалить задачу" danger>
          <Trash />
        </RadioBtn>
      ) : (
        <RadioBtn
          onClick={() => prevList && moveTo(prevList.name)}
          disabled={!prevList}
          title={prevList ? `Переместить в «${prevList.name}»` : 'Это первый список'}
        >
          <RadioCircle />
        </RadioBtn>
      )}
    </div>
  )
}
