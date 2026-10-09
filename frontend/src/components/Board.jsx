import TaskCard from './TaskCard'

export default function Board({
  tasks,
  lists,
  tags,
  activeFilter,
  activeTag,
  onSetList,
  onEdit,
  onDelete,
  onRefresh,
}) {
  const filterTasks = (allTasks) => {
    if (!allTasks) return []
    
    let filtered = allTasks
    console.log('Filtering tasks. activeFilter:', activeFilter, 'activeTag:', activeTag);

    // Filter by status/date
    if (activeFilter === 'all') {
      // Dormant cyclic tasks live in the 'Запланировано' tab only.
      filtered = filtered.filter((t) => !t.cycle_dormant)
    } else {
      if (activeFilter === 'todo') {
        filtered = filtered.filter((t) => t.list === 'Не начато')
      } else if (activeFilter === 'done') {
        filtered = filtered.filter((t) => t.list === 'Готово')
      } else if (activeFilter === 'in_progress') {
        filtered = filtered.filter((t) => !['Не начато', 'Готово', 'Архив'].includes(t.list))
      } else if (activeFilter === 'overdue') {
        const now = new Date()
        filtered = filtered.filter((t) => t.deadline && new Date(t.deadline) < now)
      } else if (activeFilter === 'planned') {
        filtered = filtered.filter((t) => t.is_cyclic)
      }
    }

    // Filter by tag
    if (activeTag) {
      console.log('Applying tag filter for activeTag:', activeTag);
      const selectedTag = tags.find(t => String(t.id) === String(activeTag));
      console.log('Selected tag object:', selectedTag);
      
      if (selectedTag) {
        filtered = filtered.filter((t) => t.tags && t.tags.includes(selectedTag.name));
        console.log('Tasks after tag filter:', filtered.length);
      } else {
        console.warn('Tag with ID', activeTag, 'not found in tags list');
      }
    }

    return filtered
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
              <h4 className="font-semibold text-sm text-white">{group.name}</h4>
              <span className="text-xs text-white/60">({group.items.length})</span>
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
                  onRefresh={onRefresh}
                />
              ))}
              {group.items.length === 0 && (
                <p className="text-xs text-white/40 italic">Нет задач</p>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
