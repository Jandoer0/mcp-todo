import { useCallback, useEffect, useRef, useState } from 'react'

// Цвета по палитре (включая "без цвета")
const TEXT_COLORS = [
  '#1e293b', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1', '#ffffff', // нейтральные
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#10b981', '#14b8a6', // акценты
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e',              // яркие
]
const HIGHLIGHT_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#ddd6fe', '#fed7aa', '#e2e8f0']

const BTN =
  'inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-400'
const BTN_ACTIVE = `${BTN} bg-blue-100 text-blue-700 font-bold`
const SEPARATOR = <span className="w-px h-5 bg-slate-300 mx-1" />

export default function Toolbar({ editor }) {
  const [colorPickerOpen, setColorPickerOpen] = useState(null) // 'color' | 'highlight' | null
  const [tableCols, setTableCols] = useState(3)
  const pickerRef = useRef(null)

  const exec = useCallback(
    (cmd, ...args) => {
      editor.chain().focus()[cmd](...args).run()
      setColorPickerOpen(null)
    },
    [editor]
  )

  const insertText = useCallback((prefix, suffix = '') => {
    editor.chain().focus().insertContent(prefix).run()
    if (suffix) editor.chain().focus().insertContent(suffix).run()
  }, [editor])

  useEffect(() => {
    const onClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setColorPickerOpen(null)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // --- Цвет текста
  const ColorPicker = ({ title, type, activeColor }) => (
    <div className="relative">
      <button
        type="button"
        className={BTN + ` ${activeColor ? 'bg-slate-200' : ''}`}
        onClick={() => setColorPickerOpen(colorPickerOpen === 'color' ? null : 'color')}
        title={title}
      >
        <span style={{ color: activeColor || 'currentColor' }}>A</span>
      </button>
      {colorPickerOpen === 'color' && (
        <div
          ref={pickerRef}
          className="absolute z-[150] mt-1 bg-white border border-slate-300 rounded-lg shadow-xl p-2 flex flex-wrap gap-1"
          style={{ top: 32, left: 0, maxHeight: 180, overflowY: 'auto' }}
        >
          <button
            type="button"
            title="Сбросить цвет"
            className="w-6 h-6 rounded border border-slate-300 flex items-center justify-center text-[10px] leading-none"
            onClick={() => {
              exec('unsetColor')
              setColorPickerOpen(null)
            }}
          >
            ✕
          </button>
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              className="w-6 h-6 rounded border border-slate-300"
              style={{ backgroundColor: c }}
              onClick={() => {
                if (c === '#ffffff') {
                  exec('unsetColor')
                } else {
                  exec('setColor', c)
                }
                setColorPickerOpen(null)
              }}
              aria-label={`Цвет ${c}`}
            />
          ))}
        </div>
      )}
    </div>
  )

  // --- Выпадающий список: заголовки
  const HeaderDropdown = () => {
    const [open, setOpen] = useState(false)
    const dropdownRef = useRef(null)

    useEffect(() => {
      const onDoc = (e) => {
        if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false)
      }
      document.addEventListener('pointerdown', onDoc)
      return () => document.removeEventListener('pointerdown', onDoc)
    }, [])

    const isActive = () => {
      const { state } = editor
      for (let level = 1; level <= 6; level++) {
        if (state.selection.$from.parent.type.name === `heading${level}`) return level
      }
      return 0
    }

    return (
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          className={BTN}
          onClick={() => setOpen(!open)}
          title="Заголовок"
        >
          H {isActive() > 0 ? isActive() : ''}
        </button>
        {open && (
          <div
            className="absolute z-[150] mt-1 bg-white border border-slate-300 rounded-lg shadow-xl py-1 min-w-[9rem]"
            style={{ top: 28, left: 0 }}
          >
            <button type="button" className={BTN + ' w-full text-left px-2'} onClick={() => { exec('setParagraph'); setOpen(false) }}>
              Обычный текст
            </button>
            {[1, 2, 3].map((lvl) => (
              <button
                key={lvl}
                type="button"
                className={BTN + ' w-full text-left px-2'}
                onClick={() => { exec('toggleHeading', { level: lvl }); setOpen(false) }}
              >
                Заголовок {lvl}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // --- Выпадающий список: списки
  const ListDropdown = () => {
    const [open, setOpen] = useState(false)
    const dropdownRef = useRef(null)

    useEffect(() => {
      const onDoc = (e) => {
        if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false)
      }
      document.addEventListener('pointerdown', onDoc)
      return () => document.removeEventListener('pointerdown', onDoc)
    }, [])

    return (
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          className={BTN}
          onClick={() => setOpen(!open)}
          title="Список"
        >
          «-»
        </button>
        {open && (
          <div
            className="absolute z-[150] mt-1 bg-white border border-slate-300 rounded-lg shadow-xl py-1 min-w-[11rem]"
            style={{ top: 28, left: 0 }}
          >
            <button type="button" className={BTN + ' w-full text-left px-2'} onClick={() => { exec('toggleBulletList'); setOpen(false) }}>
              Маркированный
            </button>
            <button type="button" className={BTN + ' w-full text-left px-2'} onClick={() => { exec('toggleOrderedList'); setOpen(false) }}>
              Нумерованный
            </button>
            <button type="button" className={BTN + ' w-full text-left px-2'} onClick={() => { exec('toggleTaskList'); setOpen(false) }}>
              Чек-лист
            </button>
          </div>
        )}
      </div>
    )
  }

  // --- Выпадающий список: вставка (таблица / изображение)
  const InsertDropdown = () => {
    const [open, setOpen] = useState(false)
    const dropdownRef = useRef(null)

    useEffect(() => {
      const onDoc = (e) => {
        if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false)
      }
      document.addEventListener('pointerdown', onDoc)
      return () => document.removeEventListener('pointerdown', onDoc)
    }, [])

    return (
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          className={BTN}
          onClick={() => setOpen(!open)}
          title="Вставить"
        >
          +
        </button>
        {open && (
          <div
            className="absolute z-[150] mt-1 bg-white border border-slate-300 rounded-lg shadow-xl py-1 min-w-[13rem]"
            style={{ top: 28, left: 0 }}
          >
            <button
              type="button"
              className={BTN + ' w-full text-left px-2'}
              onClick={() => {
                exec('insertTable', { rows: tableCols, cols: tableCols, withHeaderRow: false })
                setOpen(false)
              }}
            >
              Таблица {tableCols}×{tableCols}
            </button>
            <button
              type="button"
              className={BTN + ' w-full text-left px-2'}
              onClick={() => {
                const url = prompt('URL изображения:')
                if (url) {
                  exec('setImage', { src: url })
                  setOpen(false)
                }
              }}
            >
              Изображение
            </button>
          </div>
        )}
      </div>
    )
  }

  // --- Выбор количества столбцов таблицы
  const TableCols = () => (
    <div className="flex items-center gap-1 ml-1">
      <span className="text-[10px] text-slate-500">столбцов:</span>
      <input
        type="number"
        min="2"
        max="12"
        value={tableCols}
        onChange={(e) => setTableCols(Number(e.target.value) || 2)}
        className="w-12 px-1 py-0.5 text-xs border border-slate-300 rounded text-center"
      />
    </div>
  )

  return (
    <div
      className="flex flex-wrap items-center gap-1 p-1.5 bg-slate-100 rounded-lg border border-slate-200 text-slate-800 overflow-x-auto overflow-y-hidden"
      ref={pickerRef}
    >
      {/* undo / redo */}
      <button
        type="button"
        className={BTN}
        onClick={() => exec('undo')}
        disabled={!editor.can().undo()}
        title="Отменить (Ctrl+Z)"
      >
        ↶
      </button>
      <button
        type="button"
        className={BTN}
        onClick={() => exec('redo')}
        disabled={!editor.can().redo()}
        title="Повторить (Ctrl+Y)"
      >
        ↷
      </button>
      {SEPARATOR}
      {/* стили текста */}
      <button
        type="button"
        className={BTN + ` ${editor.isActive('bold') ? 'bg-slate-200 font-bold' : ''}`}
        onClick={() => exec('toggleBold')}
        title="Жирный"
      >
        B
      </button>
      <button
        type="button"
        className={BTN + ` ${editor.isActive('italic') ? 'italic font-bold' : ''}`}
        onClick={() => exec('toggleItalic')}
        title="Курсив"
      >
        I
      </button>
      <button
        type="button"
        className={BTN + ` ${editor.isActive('underline') ? 'underline font-bold' : ''}`}
        onClick={() => exec('toggleUnderline')}
        title="Подчёркнутый"
      >
        U
      </button>
      <button
        type="button"
        className={BTN + ` ${editor.isActive('strike') ? 'line-through' : ''}`}
        onClick={() => exec('toggleStrike')}
        title="Зачёркнутый"
      >
        S
      </button>
      <ColorPicker title="Цвет текста" type="color" activeColor={editor.isActive('textStyle') ? editor.getAttributes('textStyle').color : null} />
      <ColorPicker title="Цвет фона" type="highlight" activeColor={editor.isActive('highlight') ? editor.getAttributes('highlight').color : null} />
      {SEPARATOR}
      {/* заголовки / списки */}
      <HeaderDropdown />
      <ListDropdown />
      {SEPARATOR}
      {/* media / insert */}
      <button
        type="button"
        className={BTN}
        onClick={() => {
          const url = prompt('URL ссылки:')
          if (url) exec('setLink', { href: url })
        }}
        title="Ссылка"
      >
        🔗
      </button>
      <button
        type="button"
        className={BTN}
        onClick={() => exec('setBlockquote')}
        title="Цитата"
      >
        «
      </button>
      <button
        type="button"
        className={BTN + ` ${editor.isActive('codeBlock') ? 'bg-slate-200' : ''}`}
        onClick={() => exec('toggleCodeBlock')}
        title="Блок кода"
      >
        {'</>'}
      </button>
      <button
        type="button"
        className={BTN}
        onClick={() => insertText('`', '`')}
        title="Встроенный код"
      >
        code
      </button>
      <button
        type="button"
        className={BTN}
        onClick={() => exec('setHorizontalRule')}
        title="Разделитель"
      >
        ―
      </button>
      {SEPARATOR}
      <InsertDropdown />
      <TableCols />
    </div>
  )
}
