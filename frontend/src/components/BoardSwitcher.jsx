// Header board carousel ("барабан"): up to 3 boards visible, the active one
// strictly centered. Click a side card to switch context, click the center
// card to edit it; a special "+ Создать доску" card closes the row.
import { MAX_BOARDS } from '../constants'

export default function BoardSwitcher({ boards, activeId, onSwitch, onEdit, onCreate }) {
  const idx = boards.findIndex((b) => b.id === activeId)
  const left = idx > 0 ? boards[idx - 1] : null
  const active = idx >= 0 ? boards[idx] : null
  const right = idx >= 0 && idx < boards.length - 1 ? boards[idx + 1] : null
  const canCreate = boards.length < MAX_BOARDS // hard limit enforced server-side (20)

  const card = (board, kind) => {
    const base =
      'relative rounded-lg px-3 py-1.5 min-w-[7rem] max-w-[10rem] sm:max-w-[12rem] text-center shadow transition-all duration-200'
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

  return (
    <div className="flex items-center justify-center gap-2 min-w-0 flex-1">
      <div className="flex items-center gap-2 min-w-0">
        {left ? (
          card(left, 'side')
        ) : (
          <span className="w-16 sm:w-24" aria-hidden />
        )}
        {active && card(active, 'active')}
        {right ? (
          card(right, 'side')
        ) : canCreate ? null : (
          <span className="w-16 sm:w-24" aria-hidden />
        )}
      </div>
      {canCreate && !right && (
        <button
          onClick={onCreate}
          title="Создать новую доску"
          className="rounded-lg px-3 py-1.5 min-w-[7rem] text-center border-2 border-dashed border-white/40 text-white/70 hover:text-white hover:border-white/70 text-xs font-semibold whitespace-nowrap"
        >
          + Создать доску
        </button>
      )}
    </div>
  )
}
