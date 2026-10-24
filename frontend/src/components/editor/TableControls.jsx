import { useEffect, useRef, useState } from 'react'
import tableMoves from './tableMoves'

const BUTTONS = [
  { title: 'Удалить строку', icon: '🗑', cmd: 'deleteRow' },
  { title: 'Строка сверху', icon: '↑', cmd: 'moveRowUp' },
  { title: 'Строка снизу', icon: '↓', cmd: 'moveRowDown' },
  { title: 'Удалить столбец', icon: '🗑', cmd: 'deleteColumn' },
  { title: 'Столбец слева', icon: '←', cmd: 'moveColumnLeft' },
  { title: 'Столбец справа', icon: '→', cmd: 'moveColumnRight' },
]

export default function TableControls({ editor }) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)
  const positionRef = useRef(null)

  useEffect(() => {
    if (!editor || !editor.storage.table) return
    const fn = () => {
      const { $from } = editor.state.selection
      const cell = editor.view.state.doc.resolve($from.pos).node(-1)
      if (cell && cell.type.name === 'tableCell') {
        const rect = editor.view.coordsAtPos($from.pos)
        positionRef.current = { top: rect.bottom + 4, left: rect.left, bottom: rect.top }
        setIsOpen(true)
      } else {
        setIsOpen(false)
      }
    }
    editor.on('selectionUpdate', fn)
    editor.on('transaction', fn)
    return () => {
      editor.off('selectionUpdate', fn)
      editor.off('transaction', fn)
    }
  }, [editor])

  useEffect(() => {
    const onClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const handleCommand = (cmd) => {
    if (cmd === 'deleteRow' || cmd === 'deleteColumn') {
      editor.commands[cmd]()
    } else if (tableMoves[cmd]) {
      tableMoves[cmd]()( { editor })
    }
    setIsOpen(false)
  }

  if (!isOpen || !positionRef.current) return null
  const { top, left, bottom } = positionRef.current
  const belowSpace = bottom < window.innerHeight - 80

  return (
    <div
      ref={containerRef}
      className="fixed z-[100] rounded-lg border border-slate-300 bg-white shadow-xl py-1 px-1 flex flex-col gap-0.5 text-xs"
      style={{
        top: bottom && belowSpace ? bottom : top - 60,
        left: Math.min(left, window.innerWidth - 150),
      }}
    >
      {BUTTONS.map((b) => (
        <button
          key={b.cmd}
          type="button"
          onClick={() => handleCommand(b.cmd)}
          title={b.title}
          className="px-2 py-1.5 rounded hover:bg-slate-100 text-slate-700 hover:text-slate-900 flex items-center justify-center gap-1.5"
        >
          <span>{b.icon}</span>
          <span className="hidden sm:inline">{b.title}</span>
        </button>
      ))}
    </div>
  )
}
