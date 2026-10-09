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

export default function TaskCard({ task, allTasks = [], lists = [], tags = [], onSetList, onEdit, onDelete }) {
  // Lists are ordered by position; movement goes to the adjacent (neighbor) list
  // so a card never "jumps" over a column.
  const ordered = [...lists].sort((a, b) => a.position - b.position)
  const idx = ordered.findIndex((l) => l.name === task.list)
  const nextList = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null
  const prevList = idx > 0 ? ordered[idx - 1] : null
  const isFirst = idx === 0
  const isLast = idx === ordered.length - 1

  // Priority-based background colors
  // 1: Low (Grey), 2: Medium (White), 3: High (Reddish)
  const priorityBg = {
    1: 'bg-slate-200',
    2: 'bg-white',
    3: 'bg-red-50',
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

  return (
    <div className={`flex items-stretch rounded-md shadow-sm ${priorityBg} overflow-hidden`}>
      {/* Left zone: move to the NEXT (forward) list or delete if last */}
      {isLast ? (
        <button
          type="button"
          onClick={handleDelete}
          title="Удалить задачу"
          className="flex flex-col items-center justify-center gap-1 w-14 px-1 py-2 hover:bg-red-100 text-red-500"
        >
          <span className="text-base leading-none">🗑</span>
          <span className="text-[10px] leading-tight text-center">Удалить</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => nextList && moveTo(nextList.name)}
          disabled={!nextList}
          title={nextList ? `Переместить в «${nextList.name}»` : 'Это последний список'}
          className={`flex items-center justify-center w-14 py-2 ${
            nextList
              ? 'hover:bg-slate-200/60 text-slate-500'
              : 'opacity-40 cursor-not-allowed'
          }`}
        >
          {nextList ? <ArrowDown /> : <span className="text-sm text-gray-400">—</span>}
        </button>
      )}

      {/* Middle: open editor */}
      <div
        onClick={() => onEdit(task)}
        className="flex-1 min-w-0 p-3 cursor-pointer"
      >
        <div className="font-semibold truncate text-sm text-slate-800" title={task.title}>
          {task.title}
        </div>
        {task.description && (
          <p className="text-xs text-slate-500 mt-1 line-clamp-1 break-words italic">
            {task.description}
          </p>
        )}
        <div className="grid grid-cols-3 items-center gap-2 mt-2 text-sm">
          {/* Ячейка 1: Дата начала */}
          <div className="text-left truncate font-bold text-[11px] text-slate-600">
            {task.start_date && formatDate(task.start_date)}
          </div>

          {/* Ячейка 2: Теги */}
          <div className="text-left truncate flex gap-1 overflow-hidden">
            {(task.tags || []).map((t, idx) => {
              const name = typeof t === 'string' ? t : (t.name || t);
              const tagData = tags.find((tag) => tag.name === name);
              const color = tagData ? tagData.color : '#64748b';
              return (
                <span
                  key={idx}
                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white truncate whitespace-nowrap"
                  style={{ backgroundColor: color }}
                  title={name}
                >
                  {name}
                </span>
              );
            })}
          </div>

          {/* Ячейка 3: Дата завершения */}
          <div className="text-right truncate font-bold text-[11px] text-slate-600">
            {task.deadline && (
              <span
                className={`truncate ${
                  new Date(task.deadline) < new Date()
                    ? 'text-red-500'
                    : ''
                }`}
              >
                {formatDate(task.deadline)}
              </span>
            )}
          </div>
        </div>
        
        {/* Четвертая строка: Блокирующие задачи */}
        {(task.is_blocked || (task.blocked_by && task.blocked_by.length > 0)) && (
          <div className="flex items-center justify-end gap-1 mt-1 text-xs text-slate-500 truncate overflow-hidden">
            <div className="flex gap-1 truncate flex-row-reverse">
              {task.blocked_by && task.blocked_by.map((bid) => {
                const bTask = allTasks.find((t) => t.id === bid);
                return (
                  <span key={bid} className="px-1 rounded bg-slate-100 border border-slate-300 text-[10px] whitespace-nowrap">
                    {bTask ? bTask.title : bid}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Right zone: move to the PREVIOUS (backward) list, or delete if first */}
      {isFirst ? (
        <button
          type="button"
          onClick={handleDelete}
          title="Удалить задачу"
          className="flex flex-col items-center justify-center gap-1 w-14 px-1 py-2 hover:bg-red-100 text-red-500"
        >
          <span className="text-base leading-none">🗑</span>
          <span className="text-[10px] leading-tight text-center">Удалить</span>
        </button>
      ) : prevList ? (
        <button
          type="button"
          onClick={() => moveTo(prevList.name)}
          title={`Переместить в «${prevList.name}»`}
          className="flex items-center justify-center w-14 py-2 hover:bg-slate-200/60 text-slate-500"
        >
          <ArrowUp />
        </button>
      ) : (
        <div className="flex items-center justify-center w-14 py-2 opacity-40">
          <span className="text-sm text-slate-400">—</span>
        </div>
      )}
    </div>
  )
}
