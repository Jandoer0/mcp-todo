import { useState, useEffect, useCallback } from 'react'
import { tasksApi, summaryApi, listsApi, tagsApi } from '../api/client'

export function useTasks(ready) {
  const [tasks, setTasks] = useState([])
  const [summary, setSummary] = useState(null)
  const [lists, setLists] = useState([])
  const [tags, setTags] = useState([])
  const [activeFilter, setActiveFilter] = useState('all')
  const [activeTag, setActiveTag] = useState(null)
  const [sortBy, setSortBy] = useState('deadline')

  const load = useCallback(async () => {
    try {
      const s = await summaryApi.get()
      setSummary(s.data)
    } catch {}
    try {
      const t = await tasksApi.list()
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
    } catch {}
    try {
      setLists((await listsApi.list()).data)
    } catch {}
    try {
      setTags((await tagsApi.list()).data)
    } catch {}
  }, [sortBy])

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

  const setList = useCallback(
    async (id, listName) => {
      await update(id, { list: listName })
    },
    [update],
  )

  return {
    tasks,
    summary,
    lists,
    tags,
    activeFilter,
    setActiveFilter,
    activeTag,
    setActiveTag,
    sortBy,
    setSortBy,
    load,
    create,
    update,
    remove,
    setList,
  }
}
