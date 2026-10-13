import { useEffect, useRef, useState } from 'react'
import { MAX_BOARDS } from '../constants'

// How many neighbour cards are visible on each side of the active one,
// depending on the viewport width. Mobile keeps the compact 3-card view.
function sidesForWidth(w) {
  if (w < 640) return 1 // mobile: up to 3 cards
  if (w < 1024) return 2 // tablet: up to 5
  if (w < 1440) return 3 // desktop: up to 7
  return 3 // wide desktop: up to 7
}

// Header board carousel ("барабан"): the active board is strictly centered,
// neighbours fade towards the edges. Click a side card to switch context,
// click the center card to edit it; a "+ Создать доску" card closes the row.
export default function BoardSwitcher({ boards, activeId, onSwitch, onEdit, onCreate }) {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth
  )
  const [anim, setAnim] = useState({ dir: 0, tick: 0 })
  const prevId = useRef(activeId)

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Track switch direction to slide the cards from where the new board came.
  useEffect(() => {
    if (activeId === prevId.current) return
    const prevIdx = boards.findIndex((b) => b.id === prevId.current)
    const nextIdx = boards.findIndex((b) => b.id === activeId)
    prevId.current = activeId
    if (prevIdx === -1 || nextIdx === -1) return
    setAnim((a) => ({ dir: nextIdx > prevIdx ? 1 : -1, tick: a.tick + 1 }))
  }, [activeId, boards])

  const idx = boards.findIndex((b) => b.id === activeId)
  const sides = sidesForWidth(width)
  const visible = []
  for (let i = idx - sides; i <= idx + sides; i++) {
    visible.push(i >= 0 && i < boards.length && i !== idx ? boards[i] : null)
  }
  const active = idx >= 0 ? boards[idx] : null
  const canCreate = boards.length < MAX_BOARDS // hard limit enforced server-side
  const showCreate = canCreate && (idx === -1 || idx + sides >= boards.length - 1)

  const animClass =
    anim.dir > 0 ? 'bs-anim-right' : anim.dir < 0 ? 'bs-anim-left' : ''

  const card = (board, kind) => {
    const base =
      'relative rounded-lg px-3 py-1.5 min-w-[6rem] max-w-[8rem] sm:max-w-[11rem] text-center shadow transition-all duration-200'
    if (kind === 'active') {
      return (
        <button
          key={board.id}
          onClick={onEdit}
          title={`${board.name} — нажмите, чтобы редактировать доску`}
          className={`${base} scale-105 z-10 text-white font-bold text-sm ring-2 ring-white/90`}
          style={{ backgroundColor: board.color }}
        >
          <span className="block truncate">{board.name}</span>
        </button>
      )
    }
    return (
      <button
        key={board.id}
        onClick={() => onSwitch(board.id)}
        title={`Переключиться на «${board.name}»`}
        className={`${base} opacity-70 hover:opacity-100 text-white/90 text-xs font-semibold`}
        style={{ backgroundColor: board.color }}
      >
        <span className="block truncate">{board.name}</span>
      </button>
    )
  }

  const slot = (board) =>
    board ? (
      card(board, 'side')
    ) : (
      <span className="w-16 sm:w-24" aria-hidden />
    )

  return (
    <div className="flex items-center justify-center gap-2 min-w-0 flex-1">
      <div
        key={anim.tick}
        className={`flex items-center gap-2 min-w-0 ${animClass}`}
      >
        {visible.map((b) => slot(b))}
        {active && card(active, 'active')}
      </div>
      {showCreate && (
        <button
          onClick={onCreate}
          title="Создать новую доску"
          className="rounded-lg px-3 py-1.5 min-w-[6rem] text-center border-2 border-dashed border-white/40 text-white/70 hover:text-white hover:border-white/70 text-xs font-semibold whitespace-nowrap"
        >
          + Создать доску
        </button>
      )}
    </div>
  )
}
