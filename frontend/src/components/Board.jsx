import { useState } from 'react'
import TaskCard from './TaskCard'

// Горизонтальный канбан по образцу Planka (ТЗv2 §1):
//  - колонки — горизонтальный ряд, контейнер скроллится по X (десктоп ≥ md);
//  - карточки в колонке — вертикальный стек со своим скроллом;
//  - DnD карточек между колонками и внутри колонки (HTML5 Drag&Drop):
//    полупрозрачность переносимой карточки, подсветка колонки-приёмника,
//    вставка в конкретную позицию стека (дробный position на сервере);
//  - шапка колонки: цветовой маркер, название, счётчик, «+» и меню колонки;
//  - свайп-перенос карточек сохранён на мобильных (внутри TaskCard).
export default function Board({
  tasks,
  lists,
  tags,
  activeFilter,
  activeTag,
  boardId,
  onSetList,
  onReorder,
  onEdit,
  onDelete,
  onRefresh,
  onAddTask, // (listName) => открыть форму с пресетом колонки
  onManageLists, // открыть ListsManager
}) {
  // List semantics are user-editable (kind: todo | progress | done).
  const kindOf = (name) => lists.find((l) => l.name === name)?.kind || 'todo'

  const filterTasks = (allTasks) => {
    if (!allTasks) return []

    let filtered = allTasks

    // Filter by status/date
    if (activeFilter === 'all') {
      // Dormant cyclic tasks live in the 'Запланировано' tab only.
      filtered = filtered.filter((t) => !t.cycle_dormant)
    } else {
      if (activeFilter === 'todo') {
        filtered = filtered.filter((t) => kindOf(t.list) === 'todo' && !t.cycle_dormant)
      } else if (activeFilter === 'done') {
        filtered = filtered.filter((t) => kindOf(t.list) === 'done')
      } else if (activeFilter === 'in_progress') {
        filtered = filtered.filter((t) => kindOf(t.list) === 'progress' && !t.cycle_dormant)
      } else if (activeFilter === 'overdue') {
        const now = new Date()
        filtered = filtered.filter((t) => t.deadline && new Date(t.deadline) < now && !t.cycle_dormant)
      } else if (activeFilter === 'planned') {
        filtered = filtered.filter((t) => t.is_cyclic)
      }
    }

    // Filter by tag
    if (activeTag) {
      const selectedTag = tags.find((t) => String(t.id) === String(activeTag))
      if (selectedTag) {
        filtered = filtered.filter((t) => t.tags && t.tags.includes(selectedTag.name))
      }
    }

    return filtered
  }

  const visible = filterTasks(tasks)

  // Порядок карточек в колонке задаёт position с сервера (ТЗv2 §1.4).
  const sortTasks = (arr) =>
    [...arr].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id)

  const groups = lists.map((list) => ({
    ...list,
    items: sortTasks(visible.filter((t) => t.list === list.name)),
  }))

  // Tasks whose list is not in the configured lists (safety net).
  const orphan = sortTasks(visible.filter((t) => !lists.some((l) => l.name === t.list)))
  if (orphan.length) {
    groups.push({ id: -1, name: 'Прочее', color: '#64748b', is_default: false, items: orphan })
  }

  // ---- Collapsed columns (dnd does not apply to collapsed ones) ----
  // Collapsed by default for «Архив», expanded otherwise.
  const [collapsed, setCollapsed] = useState({})
  const isCollapsed = (name) => collapsed[name] ?? name === 'Архив'
  const toggleGroup = (name) =>
    setCollapsed((c) => ({ ...c, [name]: !(c[name] ?? name === 'Архив') }))

  // ---- Drag & Drop state ----
  // Нативный HTML5 DnD включаем только на устройствах с точным указателем
  // (десктоп): на тач-устройствах draggable перехватил бы жест у свайпа
  // карточек (ТЗv2 §1.6 — свайп на мобильных сохранён).
  const [canDrag] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches,
  )
  const [dragTask, setDragTask] = useState(null) // { id, fromList }
  const [overList, setOverList] = useState(null) // имя колонки-приёмника
  const [dropIndex, setDropIndex] = useState(null) // индекс вставки в стеке

  const handleDragStart = (e, task) => {
    setDragTask({ id: task.id, fromList: task.list })
    // Данные обязательны для Firefox; JSON позволяет получить задачу на drop.
    e.dataTransfer.setData('application/json', JSON.stringify({ id: task.id }))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragEnd = () => {
    setDragTask(null)
    setOverList(null)
    setDropIndex(null)
  }

  // Вычислить position для вставки перед индексом i (дробный индекс §1.4):
  // 0 → midpoint(0, first), середина → midpoint(a, b), конец → max + 1024.
  const positionFor = (items, i) => {
    if (!items.length) return 1024
    if (i <= 0) return (items[0].position ?? 1024) / 2
    if (i >= items.length) return (items[items.length - 1].position ?? 0) + 1024
    const prev = items[i - 1].position ?? 0
    const next = items[i].position ?? prev + 1024
    return (prev + next) / 2
  }

  const handleDrop = (e, group) => {
    e.preventDefault()
    if (!dragTask) return
    // Запрет на UI (§2.7): обычная задача не бросается в «Регулярные»;
    // drop в запрещённую колонку — просто отмена перетаскивания.
    const regular = group.kind === 'regular' || group.name === 'Регулярные'
    const cyclicSource = tasks.find((t) => t.id === dragTask.id)?.is_cyclic
    if (regular && !cyclicSource) {
      handleDragEnd()
      return
    }
    const items = group.items.filter((t) => t.id !== dragTask.id)
    const idx = dropIndex == null ? items.length : Math.min(dropIndex, items.length)
    onReorder && onReorder({ id: dragTask.id }, group.name, positionFor(items, idx))
    handleDragEnd()
  }

  // Индекс вставки: карточка, над которой курсор, и её половина.
  const indexFromEvent = (e, items) => {
    for (let i = 0; i < items.length; i++) {
      const el = document.getElementById(`card-${items[i].id}`)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (e.clientY < r.top + r.height / 2) return i
    }
    return items.length
  }

  const handleDragOver = (e, group) => {
    if (!dragTask) return
    e.preventDefault()
    // «Регулярные» принимают только циклические (ТЗv2 §1.5/§2.7): подсветка
    // ошибки, drop запрещён. Сервер всё равно проверит инвариант.
    const isRegularTarget = group.kind === 'regular' || group.name === 'Регулярные'
    const cyclicSource = tasks.find((t) => t.id === dragTask.id)?.is_cyclic
    if (isRegularTarget && !cyclicSource && group.kind !== undefined) {
      e.dataTransfer.dropEffect = 'none'
      setOverList(group.name)
      setDropIndex(null)
      return
    }
    e.dataTransfer.dropEffect = 'move'
    if (overList !== group.name) setOverList(group.name)
    setDropIndex(indexFromEvent(e, group.items))
  }

  return (
    <div className="select-none board-anim gpu-layer" key={boardId}>
      {/* Горизонтальный ряд колонок: на десктопе — один ряд со скроллом по X,
          на мобильных — вертикальный стек (свайп-перенос остаётся основным). */}
      <div
        className="flex flex-col md:flex-row md:items-stretch md:gap-3 md:overflow-x-auto md:pb-3"
      >
        {groups.map((group) => {
          const cyclicDrag = dragTask && !!tasks.find((t) => t.id === dragTask.id)?.is_cyclic
          const regular = group.kind === 'regular' || group.name === 'Регулярные'
          const forbidden = regular && dragTask && !cyclicDrag
          const isOver = overList === group.name && dragTask && !forbidden
          const sameList = dragTask && dragTask.fromList === group.name
          return (
            <section
              key={group.id}
              className={`flex flex-col md:w-0 md:min-w-0 md:flex-1 md:shrink-0 rounded-lg ${
                isOver
                  ? 'ring-2 ring-blue-400 bg-blue-400/10'
                  : forbidden
                    ? 'ring-2 ring-red-400/60 opacity-90'
                    : sameList
                      ? 'ring-1 ring-white/20'
                      : ''
              }`}
              onDragOver={(e) => handleDragOver(e, group)}
              onDragLeave={() => {
                setOverList((cur) => (cur === group.name ? null : cur))
              }}
              onDrop={(e) => handleDrop(e, group)}
            >
              {/* Шапка колонки (§1.2): маркер, название, счётчик, «+», меню */}
              <div className="flex items-center gap-2 px-1 py-2 md:px-2">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.name)}
                  className="flex items-center gap-2 min-w-0 text-left group"
                  title={isCollapsed(group.name) ? 'Развернуть колонку' : 'Свернуть колонку'}
                >
                  <span className="text-white/60 text-xs transition-transform">
                    {isCollapsed(group.name) ? '▶' : '▼'}
                  </span>
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: group.color }}
                  />
                  <h4 className="font-semibold text-sm text-white group-hover:text-white/80 truncate">
                    {group.name}
                  </h4>
                  <span className="text-xs text-white/60 shrink-0">({group.items.length})</span>
                </button>
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onAddTask && onAddTask(group.name)}
                    className="w-6 h-6 rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white flex items-center justify-center text-sm leading-none"
                    title={`Добавить задачу в «${group.name}»`}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => onManageLists && onManageLists()}
                    className="w-6 h-6 rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white flex items-center justify-center text-sm leading-none"
                    title="Настроить списки (имя, цвет, удаление)"
                  >
                    ⋯
                  </button>
                </div>
              </div>

              {/* Стек карточек: на десктопе — колонка полной высоты со своим
                  скроллом; свёрнутая колонка не рендерит карточки. */}
              {!isCollapsed(group.name) && (
                <div className="md:flex-1 md:min-h-0 md:overflow-y-auto md:pr-1 space-y-2">
                  {group.items.map((task, i) => (
                    <div
                      key={task.id}
                      id={`card-${task.id}`}
                      className="task-appear break-inside-avoid"
                      // Индикатор вставки: линия над карточкой (или в конце — пустой слот).
                      style={
                        dragTask && dropIndex === i && (isOver || sameList)
                          ? { boxShadow: '0 -2px 0 0 #60a5fa', borderRadius: 4 }
                          : undefined
                      }
                    >
                      <div
                        draggable={canDrag}
                        onDragStart={(e) => handleDragStart(e, task)}
                        onDragEnd={handleDragEnd}
                        className={dragTask?.id === task.id ? 'opacity-40' : canDrag ? 'cursor-grab active:cursor-grabbing' : ''}
                      >
                        <TaskCard
                          task={task}
                          allTasks={tasks}
                          lists={lists}
                          tags={tags}
                          onSetList={onSetList}
                          onEdit={onEdit}
                          onDelete={onDelete}
                          onRefresh={onRefresh}
                        />
                      </div>
                    </div>
                  ))}
                  {dropIndex != null && dropIndex >= group.items.length && (isOver || sameList) && (
                    <div className="h-0.5 bg-blue-400 rounded" />
                  )}
                  {group.items.length === 0 && (
                    <p className={`text-xs italic px-1 ${isOver ? 'text-white/70' : 'text-white/40'}`}>
                      {isOver ? 'Отпустите, чтобы переместить' : 'Нет задач'}
                    </p>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
