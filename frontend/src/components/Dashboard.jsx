export default function Dashboard({ summary, activeFilter, onFilterChange }) {
  if (!summary) return null

  const filters = [
    { id: 'all', label: 'Всего задач', value: summary.total, color: 'text-blue-500' },
    { id: 'todo', label: 'К выполнению', value: summary.todo, color: 'text-yellow-500' },
    { id: 'in_progress', label: 'В работе', value: summary.in_progress, color: 'text-purple-500' },
    { id: 'done', label: 'Выполнено', value: summary.done, color: 'text-green-500' },
    { id: 'overdue', label: 'Просрочено', value: summary.overdue, color: 'text-red-500' },
    { id: 'planned', label: 'Запланировано', value: summary.planned ?? 0, color: 'text-slate-400' },
  ]

  // Desktop: one compact row. Mobile: hidden — a dropdown lives in the toolbar.
  return (
    <div className="hidden md:flex gap-2 mb-6">
      {filters.map((f) => (
        <button
          key={f.id}
          onClick={() => onFilterChange(f.id)}
          className={`flex-1 px-2 py-1 rounded text-center transition-all whitespace-nowrap ${
            activeFilter === f.id 
              ? 'ring-2 ring-offset-2 ring-blue-500 bg-blue-50' 
              : 'bg-white hover:bg-gray-50'
          }`}
        >
          <span className={`text-sm font-bold ${f.color}`}>{f.value}</span>
          <span className="text-[11px] text-gray-500 ml-1.5">{f.label}</span>
        </button>
      ))}
    </div>
  )
}
