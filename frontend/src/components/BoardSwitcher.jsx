import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const TEXT_SHADOW = '0 1px 1px rgba(15, 23, 42, 0.4), 0 0 2px rgba(15, 23, 42, 0.25)'

// Лента досок в шапке: активная доска центрируется. Если весь набор
// помещается — рисуется одна копия без дублей; иначе «бесконечная» лента
// из трёх копий с якорем в средней, чтобы по краям были соседи.
export default function BoardSwitcher({ boards, activeId, onSwitch, onEdit, onReorder }) {
  const { t } = useTranslation()
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
  // Копии ленты: 1 — когда весь набор помещается в обёртку (без дублей),
  // иначе 3 — «бесконечная» лента с якорем в средней копии.
  const [copies, setCopies] = useState(1)
  const visibleBoards = count
    ? Array.from({ length: copies }, () => orderedBoards).flat()
    : []
  const anchorIndex = Math.floor(copies / 2) * count + activeIndex

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
    const strip = stripRef.current
    if (!wrap || !strip || !count) return
    // Якорная (подсвеченная) копия — именно её центрируем: раньше бралась
    // первая querySelector-копия, и активная доска уезжала вправо.
    const card = cardRefs.current.get(`card-${anchorIndex}`) || null
    if (!card) return
    // Сколько копий нужно: если весь набор досок помещается — одна копия
    // (дубли по краям не показываем), иначе 3 для бесконечной ленты.
    const setW = strip.scrollWidth / copies
    const fits = setW <= wrap.clientWidth
    const need = fits ? 1 : 3
    if (need !== copies) { setCopies(need); return }
    let next
    if (fits) {
      // Весь набор помещается — центрируем ленту целиком (без зазоров).
      next = (wrap.clientWidth - strip.scrollWidth) / 2
    } else {
      next = wrap.clientWidth / 2 - (card.offsetLeft + card.offsetWidth / 2)
      // При переполнении не даём ленте «уехать» пустотой за край.
      const min = Math.min(0, wrap.clientWidth - strip.scrollWidth)
      next = Math.max(min, Math.min(0, next))
    }
    setOffset(next)
  }, [activeId, count, copies, anchorIndex])

  useLayoutEffect(measure, [measure, boards, previewIds, activeId])
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
        data-anchor={isActive}
        onClick={() => (isActive ? onEdit() : onSwitch(board.id))}
        {...dragProps(board)}
        title={isActive ? t('board.editHint', { name: board.name }) : t('board.switchHint', { name: board.name })}
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
