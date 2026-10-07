function formatDate(value, tz) {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz || undefined,
    }).format(new Date(value))
  } catch {
    return new Date(value).toLocaleString('ru-RU')
  }
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

export default function TaskCard({ task, doneColor, progressColor, onSetList, onEdit, timezone }) {
  const isDone = task.list === 'Готово'
  const isProgress = task.list === 'В работе'
  const canDone = !task.is_blocked || isDone

  const setDone = (e) => {
    e.stopPropagation()
    if (!canDone) {
      alert('Сначала выполните блокирующие задачи')
      return
    }
    onSetList(task, 'Готово')
  }
  const setProgress = (e) => {
    e.stopPropagation()
    onSetList(task, 'В работе')
  }

  return (
    <div className="flex items-stretch border border-gray-200 dark:border-gray-700 rounded shadow-sm bg-white dark:bg-gray-800 overflow-hidden">
      {/* Left zone: "Готово" */}
      <button
        type="button"
        onClick={setDone}
        disabled={!canDone}
        title="Готово"
        className={`flex flex-col items-center justify-center gap-1 w-14 px-1 py-2 border-r border-gray-200 dark:border-gray-700 ${
          canDone ? 'hover:bg-gray-50 dark:hover:bg-gray-700' : 'opacity-50 cursor-not-allowed'
        }`}
      >
        <Radio active={isDone} color={doneColor} />
        <span className="text-[10px] leading-tight text-center text-gray-500">
          Готово
        </span>
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
            {task.start_date && formatDate(task.start_date, timezone)}
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
              <span className={`truncate ${new Date(task.deadline) < new Date(Date.now() + 24 * 60 * 60 * 1000) ? 'text-red-500 font-medium' : ''}`}>
                {formatDate(task.deadline, timezone)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right zone: "В работе" */}
      <button
        type="button"
        onClick={setProgress}
        title="В работе"
        className="flex flex-col items-center justify-center gap-1 w-14 px-1 py-2 border-l border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        <Radio active={isProgress} color={progressColor} />
        <span className="text-[10px] leading-tight text-center text-gray-500">
          В работе
        </span>
      </button>
    </div>
  )
}
