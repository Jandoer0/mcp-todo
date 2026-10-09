import { useState, useEffect, useMemo } from 'react'
import TagInput from './TagInput'
import TaskLinkInput from './TaskLinkInput'
import Modal from './Modal'

const LISTS_FALLBACK = ['Входящие', 'В планах', 'В работе', 'На проверке', 'Готово']

const EMPTY = {
  title: '',
  description: '',
  start_date: '',
  deadline: '',
  priority: 1,
  tag: '',
  list: '',
  blocked_by: [],
}

function toDatetimeLocal(value) {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export default function TaskForm({ open, onClose, onSubmit, task, tasks = [], lists = [], tags = [] }) {
  const [form, setForm] = useState(EMPTY)
  const [selectedTags, setSelectedTags] = useState([])
  const [selectedBlockers, setSelectedBlockers] = useState([])

  const listOptions = useMemo(() => 
    lists.length ? lists : LISTS_FALLBACK.map((n) => ({ name: n, color: '#64748b' })), 
    [lists]
  )

  useEffect(() => {
    if (!open) return
    if (task) {
      setForm({
        title: task.title || '',
        description: task.description || '',
        start_date: toDatetimeLocal(task.start_date),
        deadline: toDatetimeLocal(task.deadline),
        priority: task.priority ?? 1,
        list: task.list || listOptions[0]?.name || '',
        blocked_by: task.blocked_by || [],
      })
      setSelectedTags((task.tags || []).map((t) => (typeof t === 'string' ? t : t.name)))
      setSelectedBlockers(task.blocked_by || [])
    } else {
      setForm({ ...EMPTY, list: listOptions[0]?.name || '' })
      setSelectedTags([])
      setSelectedBlockers([])
    }
  }, [open, task, listOptions])

  if (!open) return null

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    // Collect only changed fields to avoid overwriting with nulls/defaults
    const payload = {}
    if (!task || form.title !== task.title) payload.title = form.title
    if (!task || form.description !== (task.description || '')) payload.description = form.description || null
    if (!task || form.start_date !== toDatetimeLocal(task.start_date)) payload.start_date = form.start_date || null
    if (!task || form.deadline !== toDatetimeLocal(task.deadline)) payload.deadline = form.deadline || null
    if (!task || Number(form.priority) !== task.priority) payload.priority = Number(form.priority)
    if (!task || form.list !== (task.list || '')) payload.list = form.list || listOptions[0]?.name || 'Не начато'
    if (!task || JSON.stringify(selectedBlockers) !== JSON.stringify(task.blocked_by || [])) {
      payload.blocked_by = selectedBlockers
    }

    const origTags = (task?.tags || []).map((t) => t.name).sort()
    const newTags = [...selectedTags].sort()
    const tagsChanged = JSON.stringify(origTags) !== JSON.stringify(newTags)

    // For a new task we always need the required fields + tags + blockers.
    if (!task) {
      payload.title = form.title
      payload.priority = Number(form.priority)
      payload.list = form.list || listOptions[0]?.name || 'Не начато'
      payload.tags = selectedTags
      payload.blocked_by = selectedBlockers
    } else if (tagsChanged) {
      payload.tags = selectedTags
    }

    onSubmit(payload)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={task ? 'Изменить задачу' : 'Создать задачу'}>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Название</label>
            <input
              type="text"
              id="task-title"
              name="title"
              placeholder="Введите название задачи"
              value={form.title}
              onChange={update('title')}
              className="w-full p-2 border rounded"
              required
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Дата начала</label>
            <input
              type="datetime-local"
              id="task-start-date"
              name="start_date"
              value={form.start_date}
              onChange={update('start_date')}
              className="w-full p-2 border rounded"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Дата завершения</label>
            <input
              type="datetime-local"
              id="task-deadline"
              name="deadline"
              value={form.deadline}
              onChange={update('deadline')}
              className="w-full p-2 border rounded"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Приоритет</label>
            <select
              id="task-priority"
              name="priority"
              value={form.priority}
              onChange={update('priority')}
              className="w-full p-2 border rounded"
            >
              <option value={1}>Низкий</option>
              <option value={2}>Средний</option>
              <option value={3}>Высокий</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Статус</label>
            <select
              id="task-list"
              name="list"
              value={form.list}
              onChange={update('list')}
              className="w-full p-2 border rounded"
            >
              {listOptions.map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Описание</label>
            <textarea
              id="task-description"
              name="description"
              placeholder="Введите описание задачи"
              value={form.description}
              onChange={update('description')}
              className="w-full p-2 border rounded"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Теги</label>
            <TagInput value={selectedTags} availableTags={tags} onChange={setSelectedTags} />
            <p className="text-xs text-gray-500 mt-1">
              Введите название и нажмите Enter. При совпадении появится выпадающий список существующих тегов.
            </p>
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Блокирующие задачи</label>
            <TaskLinkInput
              value={selectedBlockers}
              tasks={tasks}
              excludeId={task?.id}
              onChange={setSelectedBlockers}
            />
            <p className="text-xs text-gray-500 mt-1">
              Эти задачи должны быть выполнены до того, как данную можно будет отметить «Готово».
            </p>
          </div>
      <div className="md:col-span-2 flex justify-between items-center mt-4">
        <button
          type="button"
          onClick={() => {
            if (task && confirm(`Вы уверены, что хотите удалить задачу «${task.title}»?`)) {
              onSubmit({ _action: 'delete' })
            }
          }}
          disabled={!task}
          className="px-4 py-2 text-red-500 hover:text-red-600 hover:bg-red-50 rounded font-medium transition-colors"
        >
          Удалить
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded"
          >
            Отмена
          </button>
          <button
            type="submit"
            className="bg-green-600 text-white px-5 py-2 rounded hover:bg-green-700 font-medium"
          >
            {task ? 'Сохранить' : 'Создать задачу'}
          </button>
        </div>
      </div>
      </form>
    </Modal>
  )
}
