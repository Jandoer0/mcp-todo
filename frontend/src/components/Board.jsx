import TaskCard from './TaskCard'

function colorFor(lists, name, fallback) {
  const l = lists.find((x) => x.name === name)
  return l ? l.color : fallback
}

export default function Board({
  tasks,
  lists,
  filterList,
  setFilterList,
  sortBy,
  setSortBy,
  onSetList,
  onEdit,
}) {
  const doneColor = colorFor(lists, 'Готово', '#22c55e')
  const progressColor = colorFor(lists, 'В работе', '#3b82f6')

  const visible = filterList === 'all' ? tasks : tasks.filter((t) => t.list === filterList)

  const sortTasks = (arr) =>
    [...arr].sort((a, b) => {
      if (sortBy === 'priority') return b.priority - a.priority
      return (
        new Date(a.deadline || '9999-12-31') - new Date(b.deadline || '9999-12-31')
      )
    })

  const groups = lists.map((list) => ({
    ...list,
    items: sortTasks(visible.filter((t) => t.list === list.name)),
  }))

  // Tasks whose list is not in the configured lists (safety net).
  const orphan = sortTasks(visible.filter((t) => !lists.some((l) => l.name === t.list)))
  if (orphan.length) {
    groups.push({ id: -1, name: 'Прочее', color: '#64748b', is_default: false, items: orphan })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={filterList}
          onChange={(e) => setFilterList(e.target.value)}
          className="bg-white dark:bg-gray-800 border rounded p-1 text-sm"
        >
          <option value="all">Все списки</option>
          {lists.map((l) => (
            <option key={l.id} value={l.name}>
              {l.name}
            </option>
          ))}
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

      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.id}>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: group.color }}
              />
              <h4 className="font-semibold">{group.name}</h4>
              <span className="text-xs text-gray-500">({group.items.length})</span>
            </div>
            <div className="space-y-2">
              {group.items.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  doneColor={doneColor}
                  progressColor={progressColor}
                  onSetList={onSetList}
                  onEdit={onEdit}
                />
              ))}
              {group.items.length === 0 && (
                <p className="text-xs text-gray-400 italic">Нет задач</p>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
