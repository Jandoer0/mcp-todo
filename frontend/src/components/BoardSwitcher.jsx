import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MAX_BOARDS } from '../constants'

// Board card text is always white for a uniform look; on light board colors
// a subtle dark shadow keeps it readable (no color switching).
const TEXT_SHADOW = '0 1px 2px rgba(15, 23, 42, 0.55)'

// Header board carousel ("барабан"): the whole strip of boards slides inside a
// clipped viewport so that the ACTIVE card is always exactly centered. Click a
// side card to switch context, click the centered card to edit it; a special
// "+ Создать доску" card closes the strip. The number of boards visible at
// once depends on the viewport width (mobile shows ~3, wide desktop 6-7).
export default function BoardSwitcher({ boards, activeId, onSwitch, onEdit, onCreate, onReorder }) {
  const wrapRef = useRef(null)
  const stripRef = useRef(null)
  const cardRefs = useRef(new Map())
  const [offset, setOffset] = useState(0)
  // Drag-and-drop reordering of board cards (mouse with the button held)
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)

  const idx = boards.findIndex((b) => b.id === activeId)

  // Center the active card: translate the strip so that the middle of the
  // active card aligns with the middle of the viewport area.
  const measure = useCallback(() => {
    const wrap = wrapRef.current
    const card = idx >= 0 ? cardRefs.current.get(activeId) : null
    if (!wrap || !card) return
    const target = wrap.clientWidth / 2 - (card.offsetLeft + card.offsetWidth / 2)
    setOffset(target)
  }, [activeId, idx])

  useLayoutEffect(measure, [measure, boards])

  // Re-center on any size change of the wrapper or the strip itself (fonts,
  // trailing create-card appear/disappear, window resize).
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

  const dragProps = (board) => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(board.id))
      setDragId(board.id)
    },
    onDragOver: (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (board.id !== dragId) setOverId(board.id)
    },
    onDragLeave: () => setOverId((cur) => (cur === board.id ? null : cur)),
    onDrop: (e) => {
      e.preventDefault()
      if (dragId && dragId !== board.id) onReorder && onReorder(dragId, board.id)
      setDragId(null)
      setOverId(null)
    },
    onDragEnd: () => {
      setDragId(null)
      setOverId(null)
    },
  })

  const card = (board, isActive) => {
    const base =
      'shrink-0 rounded-lg px-3 py-1.5 min-w-[6rem] max-w-[9rem] sm:max-w-[12rem] text-center shadow'
    const dropMark =
      dragId && overId === board.id && dragId !== board.id
        ? ' ring-2 ring-white ring-offset-2 ring-offset-[#22384d]'
        : dragId === board.id
          ? ' opacity-40'
          : ''
    if (isActive) {
      return (
        <button
          key={board.id}
          ref={(el) => el && cardRefs.current.set(board.id, el)}
          onClick={onEdit}
          {...dragProps(board)}
          title={`${board.name} — нажмите, чтобы редактировать доску`}
          className={`${base} scale-110 z-10 font-bold text-sm ring-1 ring-white/90 gpu-layer${dropMark}`}
          style={{ backgroundColor: board.color, color: '#ffffff', textShadow: TEXT_SHADOW }}
        >
          <span className="block truncate">{board.name}</span>
        </button>
      )
    }
    return (
      <button
        key={board.id}
        ref={(el) => el && cardRefs.current.set(board.id, el)}
        onClick={() => onSwitch(board.id)}
        {...dragProps(board)}
        title={`Переключиться на «${board.name}»`}
        className={`${base} opacity-70 hover:opacity-100 text-xs font-semibold transition-opacity duration-200${dropMark}`}
        style={{ backgroundColor: board.color, color: '#ffffff', textShadow: TEXT_SHADOW }}
      >
        <span className="block truncate">{board.name}</span>
      </button>
    )
  }

  const canCreate = boards.length < MAX_BOARDS // hard limit enforced server-side

  return (
    <div ref={wrapRef} className="relative flex-1 min-w-0 overflow-hidden h-10">
      {/* Soft edge masks: boards fade out towards the clipped edges. */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-10 z-10"
        style={{ background: 'linear-gradient(90deg, #22384d 0%, transparent 100%)' }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-10 z-10"
        style={{ background: 'linear-gradient(270deg, #22384d 0%, transparent 100%)' }}
      />
      <div
        ref={stripRef}
        className="flex items-center gap-2 w-max h-full transition-transform duration-300 ease-out will-change-transform"
        style={{ transform: `translateX(${offset}px)` }}
      >
        {boards.map((b) => card(b, b.id === activeId))}
        {canCreate && (
          <button
            onClick={onCreate}
            title="Создать новую доску"
            className="shrink-0 rounded-lg px-3 py-1.5 min-w-[6rem] text-center border border-dashed border-white/40 text-white/70 hover:text-white hover:border-white/70 text-xs font-semibold whitespace-nowrap"
          >
            + Создать доску
          </button>
        )}
      </div>
    </div>
  )
}
