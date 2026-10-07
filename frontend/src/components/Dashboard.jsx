export default function Dashboard({ summary }) {
  if (!summary) return null

  const cards = [
    { label: 'Всего', value: summary.total, color: 'text-blue-500' },
    { label: 'К выполнению', value: summary.todo, color: 'text-yellow-500' },
    { label: 'В работе', value: summary.in_progress, color: 'text-purple-500' },
    { label: 'Выполнено', value: summary.done, color: 'text-green-500' },
    { label: 'Просрочено', value: summary.overdue, color: 'text-red-500' },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {cards.map((c) => (
        <div
          key={c.label}
          className="bg-white dark:bg-gray-800 p-4 rounded shadow text-center"
        >
          <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
          <div className="text-xs text-gray-500">{c.label}</div>
        </div>
      ))}
    </div>
  )
}
