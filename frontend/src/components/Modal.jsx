import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

const CLOSE_MS = 180 // matches .modal-panel-out duration

/**
 * Mobile-friendly modal: bottom sheet on phones, centered dialog on desktop.
 * - Open/close animations (overlay fade + panel slide/scale), instant when
 *   `prefers-reduced-motion: reduce`.
 * - Content scrolls inside the dialog (overscroll-contain) so the dashboard
 *   behind never scrolls.
 * - Body scroll is locked while the dialog is open.
 */
export default function Modal({ open, onClose, title, children, wide, dismissible = true }) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(open)
  const [closing, setClosing] = useState(false)
  // After the open animation finishes we drop the animation class: a lingering
  // `transform` (animation fill-mode) would turn the panel into a containing
  // block for `position: fixed` descendants and break the date-picker popup.
  const [entered, setEntered] = useState(false)
  const closeTimer = useRef(null)

  // keep in sync when parent opens the modal again
  useEffect(() => {
    if (open) {
      clearTimeout(closeTimer.current)
      setClosing(false)
      setEntered(false)
      setVisible(true)
    }
  }, [open])

  // start the leave animation, then really unmount
  const requestClose = () => {
    if (closing) return
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      onClose()
      return
    }
    setClosing(true)
    closeTimer.current = setTimeout(() => {
      setClosing(false)
      onClose()
    }, CLOSE_MS)
  }

  useEffect(() => {
    if (!visible) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(closeTimer.current)
      document.body.style.overflow = prev
    }
  }, [visible])

  if (!open || !visible) return null

  // Render into document.body via portal so the dialog is never trapped in a
  // stacking/transform context of an ancestor (e.g. a task card) — otherwise
  // `fixed` positioning breaks and the dialog does not cover the dashboard.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className={`fixed inset-0 z-[120] bg-slate-900/60 flex items-end sm:items-start sm:pt-[6vh] justify-center sm:p-4 pointer-events-auto ${
        closing ? 'modal-overlay-out' : 'modal-overlay-in'
      }`}
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) requestClose()
      }}
      // Модалка рендерится portal'ем в document.body, но React-события
      // всплывают по React-дереву — до предков (карточка задачи, доска).
      // Без stopPropagation выделение текста в диалоге «История: …»
      // запускало pointer-жест карточки и захват карточки на дашборде.
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerCancel={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onDragStart={(e) => e.stopPropagation()}
    >
      <div
        className={`bg-white text-slate-800 w-full ${
          wide ? 'sm:max-w-4xl' : 'sm:max-w-2xl'
        } rounded-t-2xl sm:rounded-lg shadow-2xl max-h-[94dvh] flex flex-col overflow-hidden ${
          closing ? 'modal-panel-out' : entered ? '' : 'modal-panel-in'
        }`}
        onAnimationEnd={() => setEntered(true)}
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
            onClick={requestClose}
            className="w-8 h-8 flex items-center justify-center rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 text-xl leading-none shrink-0"
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
