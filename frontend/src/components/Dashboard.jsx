export default function Dashboard({ summary, activeFilter, onFilterChange }) {
  if (!summary) return null

  const filters = [
    { id: 'all', label: 'Всего задач', value: summary.total, color: 'text-blue-500' },
    { id: 'todo', label: 'К выполнению', value: summary.todo, color: 'text-yellow-500' },
    { id: 'in_progress', label: 'В работе', value: summary.in_progress, color: 'text-purple-500' },
    { id: 'done', label: 'Выполнено', value: summary.done, color: 'text-green-500' },
    { id: 'overdue', label: 'Просрочено', value: summary.overdue, color: 'text-red-500' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mb-6">
      {filters.map((f) => (
        <button
          key={f.id}
          onClick={() => onFilterChange(f.id)}
          className={`p-3 sm:p-2 rounded shadow text-center transition-all ${
            activeFilter === f.id 
              ? 'ring-2 ring-offset-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/30' 
              : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
        >
          <div className={`text-xl sm:text-2xl font-bold ${f.color}`}>{f.value}</div>
          <div className="text-[11px] sm:text-xs text-gray-500">{f.label}</div>
        </button>
      ))}
    </div>
  )
}
