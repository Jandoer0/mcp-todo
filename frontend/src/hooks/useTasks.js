import { useState, useEffect, useCallback } from 'react'
import { tasksApi, summaryApi, listsApi, tagsApi } from '../api/client'

export function useTasks(ready, boardId) {
  const [tasks, setTasks] = useState([])
  const [summary, setSummary] = useState(null)
  const [lists, setLists] = useState([])
  const [tags, setTags] = useState([])
  const [activeFilter, setActiveFilter] = useState('all')
  const [activeTag, setActiveTag] = useState(null)
  // 'manual' — порядок канбан-доски (position с сервера, ТЗv2 §1.4).
  const [sortBy, setSortBy] = useState('manual')

  const load = useCallback(async () => {
    // All four requests in parallel — first render is 3-4x faster.
    if (!boardId) return
    const [sRes, tRes, lRes, gRes] = await Promise.allSettled([
      summaryApi.get(boardId),
      tasksApi.list(boardId),
      listsApi.list(boardId),
      tagsApi.list(boardId),
    ])
    if (sRes.status === 'fulfilled') setSummary(sRes.value.data)
    if (tRes.status === 'fulfilled') {
      let data = tRes.value.data
      // Сервер уже отдаёт (list, position); клиентские сортировки — только
      // когда пользователь явно выбрал режим «дедлайн» или «приоритет».
      if (sortBy === 'deadline') {
        data = [...data].sort(
          (a, b) =>
            new Date(a.deadline || '9999-12-31') -
            new Date(b.deadline || '9999-12-31'),
        )
      } else if (sortBy === 'priority') {
        data = [...data].sort((a, b) => b.priority - a.priority)
      } else {
        data = [...data].sort(
          (a, b) =>
            (a.list || '').localeCompare(b.list || '') ||
            (a.position ?? 0) - (b.position ?? 0),
        )
      }
      setTasks(data)
    }
    if (lRes.status === 'fulfilled') setLists(lRes.value.data)
    if (gRes.status === 'fulfilled') setTags(gRes.value.data)
  }, [sortBy, boardId])

  useEffect(() => {
    if (ready) load()
  }, [ready, load])

  const create = useCallback(
    async (data) => {
      await tasksApi.create({ ...data, board_id: boardId })
      await load()
    },
    [load, boardId],
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
    async (id, listName, extra = {}) => {
      // extra: например actual_date при завершении циклической через done-список
      // (§5.4 — локальная дата клиента вместо utcnow сервера).
      await update(id, { ...extra, list: listName })
    },
    [update],
  )

  // Канбан DnD (ТЗv2 §1.4): оптимистично двигаем карточку локально, затем
  // один запрос на сервер. При ошибке — перезагрузка с сервера.
  const reorder = useCallback(
    async (id, listName, position) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, list: listName, position } : t)),
      )
      try {
        await tasksApi.reorder(id, listName, position)
      } catch {
        await load()
      }
    },
    [load],
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
    reorder,
  }
}
