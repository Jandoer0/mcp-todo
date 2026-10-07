import { useState, useEffect } from 'react'

const LISTS = ['Входящие', 'В планах', 'В работе', 'На проверке', 'Готово']

const EMPTY = {
  title: '',
  description: '',
  start_date: '',
  deadline: '',
  priority: 1,
  tag: '',
  list: 'Входящие',
  blocked_by: [],
}

// Convert an ISO timestamp into a value usable by <input type="datetime-local">.
function toDatetimeLocal(value) {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export default function TaskForm({ open, onClose, onSubmit, task, tasks = [] }) {
  const [form, setForm] = useState(EMPTY)

  // Prefill when editing an existing task.
  useEffect(() => {
    if (!open) return
    if (task) {
      setForm({
        title: task.title || '',
        description: task.description || '',
        start_date: toDatetimeLocal(task.start_date),
        deadline: toDatetimeLocal(task.deadline),
        priority: task.priority ?? 1,
        tag: task.tag || '',
        list: task.list || 'Входящие',
        blocked_by: task.blocked_by || [],
      })
    } else {
      setForm(EMPTY)
    }
  }, [open, task])

  if (!open) return null

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  const updateBlockers = (e) =>
    setForm((f) => ({
      ...f,
      blocked_by: Array.from(e.target.selectedOptions).map((o) => Number(o.value)),
    }))

  const submit = (e) => {
    e.preventDefault()
    const payload = {
      title: form.title,
      description: form.description || null,
      start_date: form.start_date || null,
      deadline: form.deadline || null,
      priority: Number(form.priority),
      tag: form.tag || null,
      list: form.list || 'Входящие',
      blocked_by: form.blocked_by || [],
    }
    onSubmit(payload)
    onClose()
  }

  const editableTasks = tasks.filter((t) => !task || t.id !== task.id)

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 dark:text-gray-400"
        >
          ✕
        </button>
        <h3 className="text-xl font-bold mb-6">
          {task ? 'Изменить задачу' : 'Создать задачу'}
        </h3>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">Название</label>
            <input
              type="text"
              id="task-title"
              name="title"
              placeholder="Введите название задачи"
              value={form.title}
              onChange={update('title')}
              className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Дата начала</label>
            <input
              type="datetime-local"
              id="task-start-date"
              name="start_date"
              value={form.start_date}
              onChange={update('start_date')}
              className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Дедлайн</label>
            <input
              type="datetime-local"
              id="task-deadline"
              name="deadline"
              value={form.deadline}
              onChange={update('deadline')}
              className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Приоритет</label>
            <select
              id="task-priority"
              name="priority"
              value={form.priority}
              onChange={update('priority')}
              className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
            >
              <option value={1}>Низкий</option>
              <option value={2}>Средний</option>
              <option value={3}>Высокий</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Список</label>
            <select
              id="task-list"
              name="list"
              value={form.list}
              onChange={update('list')}
              className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
            >
              {LISTS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">Описание</label>
            <textarea
              id="task-description"
              name="description"
              placeholder="Введите описание задачи"
              value={form.description}
              onChange={update('description')}
              className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Метка</label>
            <input
              type="text"
              id="task-tag"
              name="tag"
              placeholder="напр. работа, личное"
              value={form.tag}
              onChange={update('tag')}
              className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">
              Блокирующие задачи
            </label>
            <select
              multiple
              id="task-blocked-by"
              name="blocked_by"
              value={form.blocked_by.map(String)}
              onChange={updateBlockers}
              className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 h-28"
            >
              {editableTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Эти задачи должны быть выполнены до того, как данную можно будет
              отметить как выполненную.
            </p>
          </div>
          <div className="md:col-span-2 flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-500 hover:text-gray-700 dark:text-gray-400"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600"
            >
              {task ? 'Сохранить' : 'Создать задачу'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
