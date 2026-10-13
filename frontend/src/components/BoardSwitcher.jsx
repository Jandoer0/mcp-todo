import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { MAX_BOARDS } from '../constants'

// Header board carousel ("барабан"): the whole strip of boards slides inside a
// clipped viewport so that the ACTIVE card is always exactly centered. Click a
// side card to switch context, click the centered card to edit it; a special
// "+ Создать доску" card closes the strip. The number of boards visible at
// once depends on the viewport width (mobile shows ~3, wide desktop 6-7).
export default function BoardSwitcher({ boards, activeId, onSwitch, onEdit, onCreate }) {
  const wrapRef = useRef(null)
  const stripRef = useRef(null)
  const cardRefs = useRef(new Map())
  const [offset, setOffset] = useState(0)

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

  const card = (board, kind) => {
    const base =
      'shrink-0 rounded-lg px-3 py-1.5 min-w-[6rem] max-w-[9rem] sm:max-w-[12rem] text-center shadow'
    if (kind === 'active') {
      return (
        <button
          key={board.id}
          ref={(el) => el && cardRefs.current.set(board.id, el)}
          onClick={onEdit}
          title={`${board.name} — нажмите, чтобы редактировать доску`}
          className={`${base} scale-110 z-10 text-white font-bold text-sm ring-2 ring-white/90`}
          style={{ backgroundColor: board.color }}
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
        title={`Переключиться на «${board.name}»`}
        className={`${base} opacity-60 hover:opacity-100 text-white/90 text-xs font-semibold transition-opacity duration-200`}
        style={{ backgroundColor: board.color }}
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
            className="shrink-0 rounded-lg px-3 py-1.5 min-w-[6rem] text-center border-2 border-dashed border-white/40 text-white/70 hover:text-white hover:border-white/70 text-xs font-semibold whitespace-nowrap"
          >
            + Создать доску
          </button>
        )}
      </div>
    </div>
  )
}
