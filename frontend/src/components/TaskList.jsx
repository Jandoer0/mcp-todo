export default function TaskList({
  tasks,
  onDelete,
  filterStatus,
  setFilterStatus,
  sortBy,
  setSortBy,
}) {
  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <div className="flex gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-white dark:bg-gray-800 border rounded p-1 text-sm"
          >
            <option value="all">All Statuses</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-white dark:bg-gray-800 border rounded p-1 text-sm"
          >
            <option value="deadline">Sort by Deadline</option>
            <option value="priority">Sort by Priority</option>
          </select>
        </div>
      </div>

      <div className="space-y-4">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="bg-white dark:bg-gray-800 p-4 rounded shadow flex justify-between items-start"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h4
                  className={`font-bold ${
                    task.priority === 3
                      ? 'text-red-500'
                      : task.priority === 2
                        ? 'text-yellow-500'
                        : 'text-green-500'
                  }`}
                >
                  {task.title}
                </h4>
                {task.tag && (
                  <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-2 py-0.5 rounded">
                    {task.tag}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                {task.description}
              </p>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>Status: {task.status}</span>
                {task.deadline && (
                  <span
                    className={
                      new Date(task.deadline) < new Date() && task.status !== 'done'
                        ? 'text-red-500 font-bold'
                        : ''
                    }
                  >
                    Deadline: {new Date(task.deadline).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => onDelete(task.id)}
              className="text-red-500 hover:text-red-700 ml-4"
            >
              Delete
            </button>
          </div>
        ))}
        {tasks.length === 0 && (
          <p className="text-center text-gray-500 dark:text-gray-400 py-8">
            No tasks yet.
          </p>
        )}
      </div>
    </>
  )
}
