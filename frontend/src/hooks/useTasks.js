import { useState, useEffect, useCallback } from 'react'
import { tasksApi, summaryApi } from '../api/client'

export function useTasks(ready) {
  const [tasks, setTasks] = useState([])
  const [summary, setSummary] = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const [sortBy, setSortBy] = useState('deadline')

  const load = useCallback(async () => {
    // Load summary and tasks independently so a failure in one request
    // (e.g. a 500) does not blank out the other.
    try {
      const s = await summaryApi.get()
      setSummary(s.data)
    } catch {
      // auth errors are handled by useAuth; just leave summary as-is
    }
    try {
      const t = await tasksApi.list(
        filterStatus !== 'all' ? filterStatus : undefined,
      )
      let data = t.data
      if (sortBy === 'deadline') {
        data = [...data].sort(
          (a, b) =>
            new Date(a.deadline || '9999-12-31') -
            new Date(b.deadline || '9999-12-31'),
        )
      } else if (sortBy === 'priority') {
        data = [...data].sort((a, b) => b.priority - a.priority)
      }
      setTasks(data)
    } catch {
      // leave tasks as-is on error
    }
  }, [filterStatus, sortBy])

  useEffect(() => {
    if (ready) load()
  }, [ready, load])

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

  const update = useCallback(
    async (id, data) => {
      await tasksApi.update(id, data)
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
    update,
    remove,
  }
}
