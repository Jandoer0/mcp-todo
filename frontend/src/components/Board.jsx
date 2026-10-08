import TaskCard from './TaskCard'

export default function Board({
  tasks,
  lists,
  tags,
  activeFilter,
  onSetList,
  onEdit,
  onDelete,
}) {
  const filterTasks = (allTasks) => {
    if (!allTasks) return []
    if (activeFilter === 'all') return allTasks
    
    if (activeFilter === 'todo') {
      return allTasks.filter((t) => t.list === 'Не начато')
    }
    if (activeFilter === 'done') {
      return allTasks.filter((t) => t.list === 'Готово')
    }
    if (activeFilter === 'in_progress') {
      return allTasks.filter((t) => !['Не начато', 'Готово', 'Архив'].includes(t.list))
    }
    if (activeFilter === 'overdue') {
      const now = new Date()
      return allTasks.filter((t) => t.deadline && new Date(t.deadline) < now)
    }
    return allTasks
  }

  const visible = filterTasks(tasks)

  const sortTasks = (arr) =>
    [...arr].sort(
      (a, b) =>
        new Date(a.deadline || '9999-12-31') - new Date(b.deadline || '9999-12-31')
    )

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
                  allTasks={tasks}
                  lists={lists}
                  tags={tags}
                  onSetList={onSetList}
                  onEdit={onEdit}
                  onDelete={onDelete}
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
