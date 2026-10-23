import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import TaskCard from './TaskCard'

// Плейсхолдер-«дырка» размером с перетаскиваемую карточку: открывается на
// позиции вставки, и карточки ниже сдвигаются вниз (механика Planka).
const Gap = ({ height }) => (
  <div
    className="rounded-md border-2 border-dashed border-blue-400/40 bg-blue-400/5"
    style={{ height }}
  />
)

// Горизонтальный канбан по образцу Planka (ТЗv2 §1):
//  - колонки — горизонтальный ряд ФИКСИРОВАННОЙ ширины (260px на
//    десктопе); при большем числе списков контейнер
//    скроллится по X;
//  - свёрнутая колонка на десктопе сжимается до узкой вертикальной полоски
//    (w-11) с названием — освобождая место соседним столбцам; «Архив»
//    свёрнут всегда, «Регулярные» — пока в них нет активных задач;
//  - карточки в колонке — вертикальный стек со своим скроллом;
//  - перетаскивание карточек мышью (кастомный DnD на pointer-событиях):
//    захваченная карточка «вырывается» из потока — остальные смыкаются;
//    на месте вставки открывается плейсхолдер-«дырка» (Planka); позиция
//    сохраняется дробным position на сервере. HTML5 Drag&Drop не используется —
//    он нестабилен при схлопывании исходного элемента;
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
  currencies = [], // валюта по умолчанию — первая в пользовательском порядке
  onEditCyclic,
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
  // Дефолты (ТЗv2 §1.11): «Архив» всегда свёрнут по умолчанию; «Регулярные» —
  // если в них нет активных (видимых) задач. Явный клик пользователя имеет
  // приоритет над дефолтом. На десктопе свёрнутая колонка сжимается
  // по горизонтали до узкой полоски, освобождая место соседним столбцам.
  const [collapsed, setCollapsed] = useState({})
  const isRegularCol = (g) => g.kind === 'regular' || g.name === 'Регулярные'
  // При активном фильтре (статус или тег) по умолчанию свёрнуты колонки, куда
  // не попало ни одной видимой задачи — развёрнуты только столбцы с
  // результатами фильтра. Явный клик пользователя по колонке имеет
  // приоритет над дефолтом.
  const filterActive = activeFilter !== 'all' || !!activeTag
  const defaultCollapsed = (g) =>
    filterActive
      ? g.items.length === 0
      : g.name === 'Архив' || (isRegularCol(g) && g.items.length === 0)
  const isCollapsed = (g) => collapsed[g.name] ?? defaultCollapsed(g)
  const toggleGroup = (g) =>
    setCollapsed((c) => ({ ...c, [g.name]: !(c[g.name] ?? defaultCollapsed(g)) }))

  // ---- Перетаскивание карточек мышью (механика Planka) ----
  // Кастомный DnD на pointer-событиях. HTML5 Drag&Drop не используется:
  // он нестабилен при схлопывании исходного элемента в DOM. Тач-жесты
  // (pointerType === 'touch') здесь игнорируются — на мобильных перенос
  // делает свайп внутри TaskCard (ТЗv2 §1.6).
  const [dragView, setDragView] = useState(null) // { id, fromList, h, over, index }
  const dragRef = useRef(null) // полное состояние перетаскивания
  const startRef = useRef(null) // жест начат, но порог движения не пройден
  const ghostRef = useRef(null) // DOM «призрака» под курсором
  const suppressClickRef = useRef(false) // гасим клик после перетаскивания

  // Актуальные данные для обработчиков window (не пересоздаём их каждый move).
  const dataRef = useRef({})
  dataRef.current = { tasks, groups }

  const listByName = (name) => dataRef.current.groups.find((g) => g.name === name) || null

  // Индекс вставки среди видимых карточек (перетаскиваемая исключена из
  // потока): курсор над верхней половиной карточки → вставка перед ней,
  // ниже всех → в конец.
  const indexAt = (y, listName, draggedId) => {
    const g = listByName(listName)
    if (!g) return 0
    let idx = 0
    for (const t of g.items) {
      if (t.id === draggedId) continue
      const el = document.getElementById(`card-${t.id}`)
      if (el) {
        const r = el.getBoundingClientRect()
        if (y < r.top + r.height / 2) return idx
      }
      idx++
    }
    return idx
  }

  // Колонка под курсором (по data-атрибуту секции).
  const colAt = (x, y) => {
    const el = document.elementFromPoint(x, y)
    return el?.closest?.('[data-col]')?.dataset?.col || null
  }

  // «Регулярные» принимают только циклические (ТЗv2 §1.5/§2.7).
  const dropForbidden = (listName, draggedId) => {
    const g = listByName(listName)
    if (!g) return true
    const regular = g.kind === 'regular' || g.name === 'Регулярные'
    const cyclicSource = dataRef.current.tasks.find((t) => t.id === draggedId)?.is_cyclic
    return regular && !cyclicSource
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

  // Обновить цель перетаскивания (колонка + индекс вставки) под курсором.
  const updateTarget = (x, y) => {
    const d = dragRef.current
    if (!d) return
    const col = colAt(x, y) || d.over
    const forbidden = col ? dropForbidden(col, d.id) : true
    const index = forbidden ? null : indexAt(y, col, d.id)
    if (col !== d.over || index !== d.index) {
      d.over = col
      d.index = index
      setDragView({ id: d.id, fromList: d.fromList, h: d.h, over: d.over, index: d.index })
    }
  }

  const finishDrag = (commit) => {
    const d = dragRef.current
    dragRef.current = null
    startRef.current = null
    if (d && commit && d.over && d.index != null && !dropForbidden(d.over, d.id)) {
      const g = listByName(d.over)
      if (g) {
        const items = g.items.filter((t) => t.id !== d.id)
        const idx = Math.min(d.index, items.length)
        onReorder && onReorder({ id: d.id }, d.over, positionFor(items, idx))
      }
    }
    setDragView(null)
    // Клик сразу после перетаскивания не должен открывать редактор.
    suppressClickRef.current = true
    setTimeout(() => { suppressClickRef.current = false }, 0)
  }

  // Обработчики на window: перетаскивание продолжается, даже если курсор
  // покидает карточку или колонку (захват мыши «не теряется»).
  useEffect(() => {
    if (!dragView) return
    const onMove = (e) => {
      const d = dragRef.current
      if (!d) return
      e.preventDefault()
      d.x = e.clientX
      d.y = e.clientY
      if (ghostRef.current) {
        // Без наклона: удерживаемая карточка выглядит ровно как в колонке.
        ghostRef.current.style.transform =
          `translate(${d.x - d.offX}px, ${d.y - d.offY}px)`
      }
      updateTarget(e.clientX, e.clientY)
    }
    const onUp = () => finishDrag(true)
    const onCancel = () => finishDrag(false)
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!dragView])

  const handlePointerDown = (e, task) => {
    // Тач-жесты оставляем свайпу (TaskCard); кнопки и ссылки внутри карточки
    // не должны стартовать перетаскивание.
    if (e.pointerType === 'touch') return
    if (e.button !== 0) return
    if (e.target.closest('button, a, input, textarea, select, label')) return
    const rect = e.currentTarget.getBoundingClientRect()
    startRef.current = {
      id: task.id,
      fromList: task.list,
      h: Math.round(rect.height),
      x: e.clientX,
      y: e.clientY,
      offX: e.clientX - rect.left,
      offY: e.clientY - rect.top,
    }
  }

  const handlePointerMove = (e) => {
    const s = startRef.current
    if (!s || dragRef.current) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    // Порог старта: простое нажатие/клик не считается перетаскиванием.
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return
    dragRef.current = {
      id: s.id,
      fromList: s.fromList,
      h: s.h,
      x: e.clientX,
      y: e.clientY,
      offX: s.offX,
      offY: s.offY,
      over: s.fromList,
      index: null,
    }
    startRef.current = null
    setDragView({ id: s.id, fromList: s.fromList, h: s.h, over: s.fromList, index: null })
    updateTarget(e.clientX, e.clientY)
  }

  const handlePointerUp = () => {
    if (dragRef.current) return // завершение — в window-обработчике
    startRef.current = null
  }

  const dragged = dragView ? tasks.find((t) => t.id === dragView.id) : null
  const ghostTask = dragged

  return (
    <div className="select-none board-anim gpu-layer md:flex md:flex-col md:flex-1 md:min-h-0" key={boardId}>
      {/* Горизонтальный ряд колонок: на десктопе — один ряд на всю высоту
          рабочей области со своим вертикальным скроллом колонок и
          стилизованной горизонтальной прокруткой внизу экрана (§1.12);
          на мобильных — вертикальный стек (свайп-перенос остаётся основным). */}
      <div
        className="kanban-scroll flex flex-col md:flex-row md:items-stretch md:gap-3 md:flex-1 md:min-h-0 md:overflow-x-auto md:pb-3"
      >
        {groups.map((group) => {
          const cyclicDrag = dragView && !!tasks.find((t) => t.id === dragView.id)?.is_cyclic
          const regular = isRegularCol(group)
          const forbidden = regular && dragView && !cyclicDrag
          const isOver = dragView?.over === group.name && dragView && !forbidden
          const collapsedState = isCollapsed(group)
          // Видимые карточки: перетаскиваемая «вырвана» из потока (высота 0),
          // остальные смыкаются, освобождая место (механика Planka).
          const others = group.items.filter((t) => !dragView || t.id !== dragView.id)
          const visIndex = new Map(others.map((t, i) => [t.id, i]))
          // Плейсхолдер-«дырка» открывается только в колонке под курсором:
          // карточки ниже сдвигаются вниз, освобождая место под вставку.
          const showGap = !!dragView && isOver && dragView.index != null
          const gapAtEnd = showGap && dragView.index >= others.length
          const gapHeight = dragView?.h || 48
          // Шапка колонки (§1.2): маркер, название, счётчик, «+», меню.
          // Общая для развёрнутой колонки и мобильной свёрнутой подачи.
          const headerBar = (
            <div className="flex items-center gap-2 px-1 py-2 md:px-2 shrink-0">
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                className="flex items-center gap-2 min-w-0 text-left group"
                title={collapsedState ? 'Развернуть колонку' : 'Свернуть колонку'}
              >
                <span className="text-white/60 text-xs transition-transform">
                  {collapsedState ? '▶' : '▼'}
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
                  onClick={() => onManageLists && onManageLists()}
                  className="w-6 h-6 rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white flex items-center justify-center text-sm leading-none"
                  title="Настроить списки (имя, цвет, удаление)"
                >
                  ⋯
                </button>
              </div>
            </div>
          )
          return (
            <section
              key={group.id}
              data-col={group.name}
              // Фиксированная ширина колонки: 260px на десктопе.
              // Свёрнутая колонка сжимает саму секцию до w-11 — место
              // соседним столбцам действительно освобождается.
              className={`flex flex-col md:shrink-0 md:flex-none md:transition-[width] md:duration-200 rounded-lg ${
                collapsedState ? 'md:w-11' : 'md:w-[260px]'
              } ${
                isOver
                  ? 'bg-blue-400/10'
                  : forbidden
                    ? 'opacity-90'
                    : ''
              }`}
            >
              {collapsedState ? (
                <>
                  {/* Десктоп: свёрнутая колонка — узкая вертикальная полоска,
                      освобождая место для соседних столбцов (§1.11). */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(group)}
                    className="hidden md:flex w-full shrink-0 flex-col items-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/15 transition-colors"
                    title={`Развернуть «${group.name}»`}
                  >
                    <span className="text-white/70 text-xs">▶</span>
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: group.color }}
                    />
                    <span
                      className="text-white/85 text-xs font-semibold whitespace-nowrap"
                      style={{ writingMode: 'vertical-rl' }}
                    >
                      {group.name}
                    </span>
                    <span className="text-[10px] text-white/50">({group.items.length})</span>
                  </button>
                  {/* Мобильная вертикальная подача: привычная шапка, стек скрыт */}
                  <div className="md:hidden">{headerBar}</div>
                </>
              ) : (
                <>
                  {headerBar}

              {/* Стек карточек: на десктопе — колонка полной высоты со своим
                  скроллом; свёрнутая колонка не рендерит карточки. */}
              {!collapsedState && (
                <div className="flex flex-col md:flex-1 md:min-h-0">
                  <div className="flex-1 overflow-y-auto md:pr-1 space-y-2 pb-2">
                    {group.items.map((task) => {
                      const isDragged = dragView?.id === task.id
                      const gapHere = showGap && !isDragged && dragView.index === visIndex.get(task.id)
                      return (
                        <Fragment key={task.id}>
                          {gapHere && <Gap height={gapHeight} />}
                          <div
                            id={`card-${task.id}`}
                            className={`task-appear break-inside-avoid transition-all duration-200 ${
                              isDragged ? 'overflow-hidden pointer-events-none' : ''
                            }`}
                            // Захваченная карточка схлопывается (высота 0):
                            // остальные карточки смыкаются, освобождая место.
                            style={isDragged ? { height: 0, marginTop: 0, opacity: 0 } : undefined}
                            onPointerDown={(e) => handlePointerDown(e, task)}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onClickCapture={(e) => {
                              // Клик после перетаскивания не открывает редактор.
                              if (suppressClickRef.current) {
                                e.stopPropagation()
                                e.preventDefault()
                              }
                            }}
                          >
                            <TaskCard
                              task={task}
                              allTasks={tasks}
                              lists={lists}
                              tags={tags}
                              onSetList={onSetList}
                              onEdit={onEdit}
                              onEditCyclic={onEditCyclic}
                              onDelete={onDelete}
                              onRefresh={onRefresh}
                              currencies={currencies}
                            />
                          </div>
                        </Fragment>
                      )
                    })}
                    {gapAtEnd && <Gap height={gapHeight} />}
                    {group.items.length === 0 && (
                      <p className={`text-xs italic px-1 ${isOver ? 'text-white/70' : 'text-white/40'}`}>
                        {isOver ? 'Отпустите, чтобы переместить' : 'Нет задач'}
                      </p>
                    )}
                    {/* Кнопка добавления — последняя «карточка» столбика:
                        прижата к последней задаче, а не к низу колонки. */}
                    <button
                      type="button"
                      onClick={() => (regular ? onEditCyclic?.() : onAddTask?.(group.name))}
                      className="w-full py-2 rounded bg-white/5 text-white/60 hover:bg-white/10 hover:text-white text-xs transition-colors border border-dashed border-white/20"
                    >
                      + Добавить задачу
                    </button>
                  </div>
                </div>
              )}
                </>
              )}
            </section>
          )
        })}
      </div>

      {/* «Призрак» — копия карточки под курсором во время перетаскивания. */}
      {dragView && ghostTask &&
        createPortal(
          <div
            ref={ghostRef}
            className="fixed top-0 left-0 z-[100] w-64 pointer-events-none shadow-2xl rounded-md will-change-transform"
            style={{ transform: 'translate(-9999px, -9999px)' }}
          >
            <TaskCard
              task={ghostTask}
              allTasks={tasks}
              lists={lists}
              tags={tags}
              onSetList={() => {}}
              onEdit={() => {}}
              onEditCyclic={() => {}}
              onDelete={() => {}}
              onRefresh={() => {}}
              currencies={currencies}
            />
          </div>,
          document.body
        )}
    </div>
  )
}
