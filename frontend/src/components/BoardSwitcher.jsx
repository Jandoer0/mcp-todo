import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MAX_BOARDS } from '../constants'

const TEXT_SHADOW = '0 1px 1px rgba(15, 23, 42, 0.4), 0 0 2px rgba(15, 23, 42, 0.25)'

// Бесконечная лента: активная доска всегда находится в средней копии
// циклического ряда, поэтому по обе стороны от неё всегда есть соседи.
export default function BoardSwitcher({ boards, activeId, onSwitch, onEdit, onReorder }) {
  const wrapRef = useRef(null)
  const stripRef = useRef(null)
  const cardRefs = useRef(new Map())
  const [offset, setOffset] = useState(0)
  const [dragId, setDragId] = useState(null)
  const [previewIds, setPreviewIds] = useState(null)
  const prevRects = useRef(new Map())

  const origIds = boards.map((b) => b.id)
  const orderIds = previewIds || origIds
  const orderedBoards = orderIds.map((id) => boards.find((b) => b.id === id)).filter(Boolean)
  const count = orderedBoards.length
  const activeIndex = Math.max(0, orderIds.indexOf(activeId))
  // Три копии дают запас для видимых карточек по краям. Средняя копия
  // используется как якорь и не позволяет ленте «закончиться».
  const visibleBoards = count
    ? [...orderedBoards, ...orderedBoards, ...orderedBoards]
    : []
  const anchorIndex = count + activeIndex

  useLayoutEffect(() => {
    if (!dragId) return
    const next = new Map()
    cardRefs.current.forEach((el, key) => next.set(key, el.getBoundingClientRect()))
    cardRefs.current.forEach((el, key) => {
      const old = prevRects.current.get(key)
      const now = next.get(key)
      if (!old || !now) return
      const dx = old.left - now.left
      if (!dx) return
      if (el._flipRaf) cancelAnimationFrame(el._flipRaf)
      el.style.transition = 'none'
      el.style.transform = `translateX(${dx}px)`
      el._flipRaf = requestAnimationFrame(() => {
        el._flipRaf = null
        el.style.transition = 'transform 280ms ease-out'
        el.style.transform = ''
      })
    })
    prevRects.current = next
  }, [previewIds, dragId])

  const measure = useCallback(() => {
    const wrap = wrapRef.current
    const card = wrap.querySelector(`[data-board-id="${activeId}"]`) || null
    if (!wrap || !card) return
    setOffset(wrap.clientWidth / 2 - (card.offsetLeft + card.offsetWidth / 2))
  }, [activeId])

  useLayoutEffect(measure, [measure, boards, previewIds])
  useEffect(() => {
    const ro = new ResizeObserver(measure)
    if (wrapRef.current) ro.observe(wrapRef.current)
    if (stripRef.current) ro.observe(stripRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  const reorderPreview = (hoveredId, after) => {
    if (!dragId || hoveredId === dragId) return
    setPreviewIds((current) => {
      const base = current || origIds
      const without = base.filter((id) => id !== dragId)
      let index = without.indexOf(hoveredId)
      if (index < 0) return base
      if (after) index += 1
      const next = [...without]
      next.splice(index, 0, dragId)
      return next.some((id, i) => id !== base[i]) ? next : base
    })
  }

  const dragProps = (board) => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(board.id))
      setDragId(board.id)
      setPreviewIds(origIds)
      const initial = new Map()
      cardRefs.current.forEach((el, key) => initial.set(key, el.getBoundingClientRect()))
      prevRects.current = initial
    },
    onDragOver: (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (!dragId || board.id === dragId) return
      const r = e.currentTarget.getBoundingClientRect()
      reorderPreview(board.id, e.clientX > r.left + r.width / 2)
    },
    onDrop: (e) => {
      e.preventDefault()
      if (dragId && previewIds && onReorder) onReorder(dragId, previewIds)
      setDragId(null)
      setPreviewIds(null)
    },
    onDragEnd: () => {
      setDragId(null)
      setPreviewIds(null)
    },
  })

  const renderCard = (board, index) => {
    // Только карточка в средней копии считается активной. Боковые копии
    // того же board.id остаются обычными переключателями и не открывают
    // редактор при клике.
    const isActive = index === anchorIndex
    const key = `card-${index}`
    const dropMark = dragId === board.id ? ' opacity-40' : ''
    const base = 'shrink-0 rounded-lg px-3 py-1.5 min-w-[6rem] max-w-[9rem] sm:max-w-[12rem] text-center shadow'
    return (
      <button
        key={key}
        ref={(el) => {
          if (el) cardRefs.current.set(key, el)
          else cardRefs.current.delete(key)
        }}
        data-board-id={board.id}
        onClick={() => (isActive ? onEdit() : onSwitch(board.id))}
        {...dragProps(board)}
        title={isActive ? `${board.name} — нажмите, чтобы редактировать доску` : `Переключиться на «${board.name}»`}
        className={`${base} ${isActive ? 'z-10 font-bold text-sm ring-2 ring-white/90 px-4 py-2 -my-0.5' : 'opacity-70 hover:opacity-100 text-xs font-semibold transition-opacity duration-200'}${dropMark}`}
        style={{ backgroundColor: board.color, color: '#ffffff', textShadow: TEXT_SHADOW }}
      >
        <span className="block truncate">{board.name}</span>
      </button>
    )
  }

  return (
    <div ref={wrapRef} className="relative flex-1 min-w-0 overflow-hidden h-10">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 z-10" style={{ background: 'linear-gradient(90deg, #22384d 0%, transparent 100%)' }} />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 z-10" style={{ background: 'linear-gradient(270deg, #22384d 0%, transparent 100%)' }} />
      <div
        ref={stripRef}
        className="board-strip flex items-center gap-2 w-max h-full transition-transform duration-300 ease-out will-change-transform"
        style={{ transform: `translateX(${offset}px)` }}
      >
        {visibleBoards.map((board, index) => renderCard(board, index))}
      </div>
    </div>
  )
}
