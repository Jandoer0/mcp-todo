import { useState, useEffect, useCallback } from 'react'
import { tasksApi, summaryApi } from '../api/client'

export function useTasks() {
  const [tasks, setTasks] = useState([])
  const [summary, setSummary] = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const [sortBy, setSortBy] = useState('deadline')

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([
        tasksApi.list(filterStatus !== 'all' ? filterStatus : undefined),
        summaryApi.get(),
      ])
      let data = t.data
      if (sortBy === 'deadline') {
        data = [...data].sort(
          (a, b) =>
            new Date(a.deadline || '9999-12-31') - new Date(b.deadline || '9999-12-31'),
        )
      } else if (sortBy === 'priority') {
        data = [...data].sort((a, b) => b.priority - a.priority)
      }
      setTasks(data)
      setSummary(s.data)
    } catch {
      // auth errors are handled by useAuth; just leave state unchanged
    }
  }, [filterStatus, sortBy])

  useEffect(() => {
    load()
  }, [load])

  const create = useCallback(
    async (data) => {
      await tasksApi.create(data)
      await load()
    },
    [load],
  )

  const remove = useCallback(
    async (id) => {
      await tasksApi.remove(id)
      await load()
    },
    [load],
  )

  return {
    tasks,
    summary,
    filterStatus,
    setFilterStatus,
    sortBy,
    setSortBy,
    load,
    create,
    remove,
  }
}
