const STATUS_LABELS = {
  todo: 'К выполнению',
  in_progress: 'В работе',
  done: 'Выполнено',
}

const PRIORITY_COLORS = {
  3: 'text-red-500',
  2: 'text-yellow-500',
  1: 'text-green-500',
}

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

export default function TaskList({
  tasks,
  onDelete,
  onEdit,
  onSetStatus,
  filterStatus,
  setFilterStatus,
  sortBy,
  setSortBy,
}) {
  // id -> title, used to show blocker task names.
  const titleById = Object.fromEntries(tasks.map((t) => [t.id, t.title]))

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <div className="flex gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-white dark:bg-gray-800 border rounded p-1 text-sm"
          >
            <option value="all">Все статусы</option>
            <option value="todo">К выполнению</option>
            <option value="in_progress">В работе</option>
            <option value="done">Выполнено</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-white dark:bg-gray-800 border rounded p-1 text-sm"
          >
            <option value="deadline">Сортировать по дедлайну</option>
            <option value="priority">Сортировать по приоритету</option>
          </select>
        </div>
      </div>

      <div className="space-y-4">
        {tasks.map((task) => {
          const overdue =
            task.deadline && new Date(task.deadline) < new Date() && task.status !== 'done'
          const isDone = task.status === 'done'
          const blockerTitles = (task.blocked_by || [])
            .map((id) => titleById[id])
            .filter(Boolean)
          return (
            <div
              key={task.id}
              className="bg-white dark:bg-gray-800 p-4 rounded shadow flex justify-between items-start"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h4
                    className={`font-bold ${
                      PRIORITY_COLORS[task.priority] || 'text-green-500'
                    }`}
                  >
                    {task.title}
                  </h4>
                  {task.tag && (
                    <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-2 py-0.5 rounded">
                      {task.tag}
                    </span>
                  )}
                  {task.is_blocked && (
                    <span className="text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 px-2 py-0.5 rounded">
                      Заблокирована
                    </span>
                  )}
                  {isDone && (
                    <span className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 px-2 py-0.5 rounded">
                      Готово
                    </span>
                  )}
                </div>
                {task.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                    {task.description}
                  </p>
                )}
                <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                  <span>Статус: {STATUS_LABELS[task.status] || task.status}</span>
                  {task.start_date && <span>Начало: {formatDate(task.start_date)}</span>}
                  {task.deadline && (
                    <span className={overdue ? 'text-red-500 font-bold' : ''}>
                      Дедлайн: {formatDate(task.deadline)}
                    </span>
                  )}
                  {task.list && <span>Список: {task.list}</span>}
                </div>
                {blockerTitles.length > 0 && (
                  <div className="mt-2 text-xs text-gray-500">
                    Блокирующие задачи: {blockerTitles.join(', ')}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2 ml-4">
                {isDone ? (
                  <button
                    onClick={() => onSetStatus(task, 'in_progress')}
                    className="text-xs text-blue-500 hover:underline"
                  >
                    Вернуть в работу
                  </button>
                ) : (
                  <button
                    onClick={() => onSetStatus(task, 'done')}
                    disabled={task.is_blocked}
                    title={
                      task.is_blocked
                        ? 'Сначала выполните блокирующие задачи'
                        : undefined
                    }
                    className="text-xs text-green-500 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
                  >
                    Выполнено
                  </button>
                )}
                <button
                  onClick={() => onEdit(task)}
                  className="text-xs text-blue-500 hover:underline"
                >
                  Изменить
                </button>
                <button
                  onClick={() => onDelete(task.id)}
                  className="text-red-500 text-xs hover:underline"
                >
                  Удалить
                </button>
              </div>
            </div>
          )
        })}
        {tasks.length === 0 && (
          <p className="text-center text-gray-500 dark:text-gray-400 py-8">
            Задач пока нет.
          </p>
        )}
      </div>
    </>
  )
}
