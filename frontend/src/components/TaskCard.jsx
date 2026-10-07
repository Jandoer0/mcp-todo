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

function Radio({ active, color }) {
  return (
    <span
      className="inline-block w-4 h-4 rounded-full border-2 flex-shrink-0"
      style={{
        borderColor: color,
        backgroundColor: active ? color : 'transparent',
      }}
    />
  )
}

export default function TaskCard({ task, lists = [], onSetList, onEdit, onDelete }) {
  // Lists are ordered by position; movement goes to the adjacent (neighbor) list
  // so a card never "jumps" over a column.
  const ordered = [...lists].sort((a, b) => a.position - b.position)
  const idx = ordered.findIndex((l) => l.name === task.list)
  const nextList = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null
  const prevList = idx > 0 ? ordered[idx - 1] : null
  const isFirst = idx === 0

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
    <div className="flex items-stretch border border-gray-200 dark:border-gray-700 rounded shadow-sm bg-white dark:bg-gray-800 overflow-hidden">
      {/* Left zone: move to the NEXT (forward) list */}
      <button
        type="button"
        onClick={() => nextList && moveTo(nextList.name)}
        disabled={!nextList}
        title={nextList ? `Переместить в «${nextList.name}»` : 'Это последний список'}
        className={`flex flex-col items-center justify-center gap-1 w-14 px-1 py-2 border-r border-gray-200 dark:border-gray-700 ${
          nextList
            ? 'hover:bg-gray-50 dark:hover:bg-gray-700'
            : 'opacity-40 cursor-not-allowed'
        }`}
      >
        {nextList ? (
          <>
            <Radio active color={nextList.color} />
            <span className="text-[10px] leading-tight text-center text-gray-500">
              {nextList.name}
            </span>
          </>
        ) : (
          <span className="text-[10px] text-gray-400">—</span>
        )}
      </button>

      {/* Middle: open editor */}
      <div
        onClick={() => onEdit(task)}
        className="flex-1 min-w-0 p-3 cursor-pointer"
      >
        <div className="font-semibold truncate" title={task.title}>
          {task.title}
        </div>
        {task.description && (
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-1 break-words">
            {task.description}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 mt-2 text-[11px] text-gray-500">
          <div className="flex-shrink-0 truncate text-sm text-gray-700 dark:text-gray-300">
            {task.start_date && formatDate(task.start_date)}
          </div>
          <div className="flex flex-wrap justify-center items-center gap-2">
            {(task.tags || []).map((t) => (
              <span
                key={t.name}
                className="px-2 py-0.5 rounded-full text-white truncate max-w-[10rem]"
                style={{ backgroundColor: t.color || '#64748b' }}
                title={t.name}
              >
                {t.name}
              </span>
            ))}
            {task.is_blocked && (
              <span className="text-red-500 font-medium">Заблокирована</span>
            )}
          </div>
          <div className="flex-shrink-0 text-right truncate text-sm text-gray-700 dark:text-gray-300">
            {task.deadline && (
              <span
                className={`truncate ${
                  new Date(task.deadline) < new Date(Date.now() + 24 * 60 * 60 * 1000)
                    ? 'text-red-500 font-medium'
                    : ''
                }`}
              >
                {formatDate(task.deadline)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right zone: move to the PREVIOUS (backward) list, or delete if first */}
      {isFirst ? (
        <button
          type="button"
          onClick={handleDelete}
          title="Удалить задачу"
          className="flex flex-col items-center justify-center gap-1 w-14 px-1 py-2 border-l border-gray-200 dark:border-gray-700 hover:bg-red-50 dark:hover:bg-red-900/30 text-red-500"
        >
          <span className="text-base leading-none">🗑</span>
          <span className="text-[10px] leading-tight text-center">Удалить</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => moveTo(prevList.name)}
          title={`Переместить в «${prevList.name}»`}
          className="flex flex-col items-center justify-center gap-1 w-14 px-1 py-2 border-l border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Radio active color={prevList.color} />
          <span className="text-[10px] leading-tight text-center text-gray-500">
            {prevList.name}
          </span>
        </button>
      )}
    </div>
  )
}
