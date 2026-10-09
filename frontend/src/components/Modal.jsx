import { useEffect } from 'react'

/**
 * Mobile-friendly modal: bottom sheet on phones, centered dialog on desktop.
 * - Content scrolls inside the dialog (overscroll-contain) so the dashboard
 *   behind never scrolls.
 * - Body scroll is locked while the dialog is open.
 */
export default function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`bg-white text-slate-800 w-full ${
          wide ? 'sm:max-w-4xl' : 'sm:max-w-2xl'
        } rounded-t-2xl sm:rounded-lg shadow-2xl max-h-[94dvh] flex flex-col overflow-hidden`}
      >
        {/* Grabber for the mobile bottom sheet */}
        <div className="sm:hidden flex justify-center pt-2 shrink-0">
          <span className="w-10 h-1.5 rounded-full bg-slate-300" />
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <h3 className="text-base font-bold flex items-center gap-2 min-w-0">
            <span className="w-2 h-4 bg-[#22384d] rounded-sm inline-block shrink-0" />
            <span className="truncate">{title}</span>
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 text-xl leading-none shrink-0"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  )
}
