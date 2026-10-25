import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Цвета по палитре (включая "без цвета")
const PALETTE = [
  '#1e293b', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1', '#ffffff', // нейтральные
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#10b981', '#14b8a6', // акценты
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e',              // яркие
]

const FONT_COLORS = PALETTE
const HIGHLIGHT_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#ddd6fe', '#fed7aa', '#e2e8f0']

const BTN_STYLE =
  'inline-flex items-center justify-center rounded px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed'
const SEPARATOR = <span className="w-px h-5 bg-slate-300 mx-1" />

export default function Toolbar({ editor }) {
  const [colorPicker, setColorPicker] = useState(null)
  const [hlPicker, setHlPicker] = useState(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [imgSrc, setImgSrc] = useState('')
  const [tableCols, setTableCols] = useState(3)
  const pickerRef = useRef(null)

  const exec = useCallback((cmd, ...args) => {
    editor.chain().focus()[cmd](...args).run()
    setColorPicker(null); setHlPicker(null); setEmojiOpen(false)
  }, [editor])

  const insertText = useCallback((prefix, suffix = '') => {
    editor.chain().focus().insertContent(prefix).run()
    if (suffix) editor.chain().insertContent(suffix).run()
  }, [editor])

  // --- emoji ---
  useEffect(() => {
    const onClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setColorPicker(null); setHlPicker(null); setEmojiOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const emojis = ['😀','😁','😂','🤣','😊','😎','🤩','😇','🥰','😍','🤔','🤨','😐','😑',
    '😶','😏','😒','🙄','😬','🤥','😌','😴','🥱','😷','🤒','🤕','🤢','🤮','🤧','🥶',
    '🤠','🥳','🥴','🥺','🤡','👻','💀','👽','🤖','💩','🎃','👺','👹','🙈','🙉','🙊',
    '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖',
    '✨','🔥','💯','⭐','🌟','💫','💥','🌈','☀️','🌙','⛅','🌧','⛈','🌪','🔔','🔕',
    '✅','❌','➕','➖','➗','➡️','⬅️','⬆️','⬇️','🔼','🔽','🔑','🔒','🔏','📎','🖇',
    '📌','📍','📏','📐','📝','✏️','✂️','🗂','📁','📂','📅','📆','📇','📈','📉','🗜','📩',
    '⚙️','🔧','🗑','🔋','🖨','⏰','⏳','🔔','🔕','📢','📣','🎈','🎉','🎊','🎁','🎀','🏆',
    '🚀','✈️','🚗','🚲','🚲','🏠','🏢','🌳','🌲','🌴','🏡','🗺','🏨','🏪','🏫','🏭','🏯',
    '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔',
    '🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞',
    '🐜','🦟','🦗','🕷','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡',
    '🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦏','🦛','🦘','🐪','🐫','🦒',
    '🦮','🐕','🐩','🐈','🐓','🦃','🦚','🦜','🦢','🦩','🕊','🐇','🐁','🐀','🐿','🦔',
    '🍎','🍏','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥',
    '🥝','🍅','🍆','🥑','🥦','🥒','🌶','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐',
    '🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🥩','🍖','🦴',
    '🍔','🍟','🍕','🌭','🥪','🌮','🌯','🫔','🥙','🧆','🥗','🥘','🫕','🥫','🍝','🍜',
    '🍲','🍛','🍚','🍘','🍙','🍚','🍠','🍢','🍣','🍱','🥟','🦪','🍤','🍙','🍥',
    '🥠','🥮','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿',
    '🍩','🍪','🌰','🥜','🍯','🥛','☕','🫖','🍵','🍶','🍾','🍷','🍹','🍺','🍻','🥂',
    '🥃','🥤','🧃','🧉','🍔','🥡','🦠','💊','🩺','🩹','🩸','💉','🩻','🧬','🔬',
    '🔭','📡','💻','🖥','🖨','⌨️','🖱','🖲','💽','💾','📀','📼','🔋','🔌','⏱','⏰',
    '⏲','⏳','📱','📲','💈','📞','☎️','📟','📠','📺','📻','🎙','🎚','🎛','⏯','🎤',
    '🎧','📢','📣','📯','🔔','🔕','🎼','🎵','🎶','🎙','🎚','🎛','🎤','🎧','🎹','🎺',
    '🎸','🪕','🥁','🎷','🎻','🪀','🪁','🎿','🛷','⛷','🏂','🏌️','🏇','⛹️','🏋️','🚣',
    '🚣','🚣','🚣','🏊','🤿','🏄','🏐','🏀','🏈','🏉','🎾','🥏','🎳','🏏','🏑','🏒',
    '🥍','🏓','🏸','🥊','🥋','🥅','⛳','⛸','🎯','🪀','🎱','🔮','🪄','🧿','🎮','🕹',
    '🎰','🎲','🧩','🧸','♠️','♥️','♦️','♣️','🃏','🀄','🎴','🎭','🖼','🎨','🧵','🪡',
    '🧶','🥌','🎪','🤹','🎬','🎟','🎫','🎖','🏅','🥇','🥈','🥉','🏆','🥏','🎗','🎟',
    '🎫','🎖','🏅','🥇','🥈','🥉','🏆','🎗','🎟','🎫','🎪','🤹','🎬','🎫','📜','📄','📃','📑',
    '🗒','🗃','📚','📖','📕','📗','📘','📙','📔','📒','📓','🔖','🔘','🔗','🔪','🗡','🔫',
    '🏹','🛡','⚔️','🔮','🔦','🏺','🔑','🗝','🔨','🪓','⛏','⚒','🛠','🗡','🔫','🏹','⚗️',
    '🔭','🔬','💊','💉','🩸','🧪','🧫','🧬','🦠','🦠','🔌','⚡','🔋','🔦','🕯','🪔',
    '🧯','🛢','💸','💵','💴','💶','💷','💰','💳','💎','⚖️','🧰','🔧','🔨','⚒','🛠','⛏',
    '🔫','🏹','🛡','⚔️','🔪','🗡','⚔','🏺','🔑','🗝','🔏','🔐','🔒','🔓','❤️','💔',
    '❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☦️','☪️','☸️','✡️','🔯',
    '🕉','☸','✡','🔯','🕉','☸','✡','🔯','☯','✝','☦','☪','☸','✡','🔯','🕉',
    '🛐','⛎','🔀','🔁','🔂','🔼','🔽','🔃','🔄','🔙','🔚','🔛','🔜','🔝','🛐','⚛',
    '🉐','㊙️','㊗️','🈴','🈳','㊀','㊁','㊂','㊃','㊄','㊅','㊆','㊇','㊈','㊉','🈺','🈵',
    '🈹','🈲','🉑','🈸','🈶','🈚','🈷️','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️',
    '🌀','♉','♈','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','♈','🆔','⚕️','♾','♿',
    '⭕','✅','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚪️','⚫️','🟥','🟧','🟨','🟩',
    '🟦','🟪','🏁','🚩','🎌','🏴','🏳️','🏳️‍🌈','🏴‍☠️','🇦🇨','🇦🇩','🇦🇪','🇦🇫','🇦🇬','🇦🇮',
  ]

  // --- image dialog ---
  const [imgDialogOpen, setImgDialogOpen] = useState(false)
  const handleImage = () => setImgDialogOpen(true)
  const submitImage = () => {
    if (imgSrc.trim()) {
      const url = imgSrc.trim()
      exec('setImage', { src: url })
    }
    setImgSrc(''); setImgDialogOpen(false)
  }

  // --- table ---
  const handleTable = () => {
    editor.chain().focus().insertTable({ rows: tableCols, cols: tableCols, withHeaderRow: false }).run()
    setEmojiOpen(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-1 p-1.5 bg-slate-100 rounded-lg border border-slate-200 text-slate-800" ref={pickerRef}>
      {/* undo / redo */}
      <button type="button" className={BTN_STYLE} onClick={() => exec('undo')} disabled={!editor.can().undo()} title="Отменить">
        ↶
      </button>
      <button type="button" className={BTN_STYLE} onClick={() => exec('redo')} disabled={!editor.can().redo()} title="Повторить">
        ↷
      </button>
      {SEPARATOR}
      {/* стили текста */}
      <button type="button" className={BTN_STYLE} onClick={() => exec('toggleBold')} title="Жирный">
        <b>B</b>
      </button>
      <button type="button" className={BTN_STYLE} onClick={() => exec('toggleItalic')} title="Курсив">
        <i>I</i>
      </button>
      <button type="button" className={BTN_STYLE} onClick={() => exec('toggleUnderline')} title="Подчёркнутый">
        <u>U</u>
      </button>
      <button type="button" className={BTN_STYLE} onClick={() => exec('toggleStrike')} title="Зачёркнутый">
        <s>S</s>
      </button>
      <button type="button"
        className={BTN_STYLE}
        onClick={(e) => {
          e.stopPropagation()
          setHlPicker(p => p === 'color' ? null : 'color')
          setColorPicker(null)
        }}
        title="Цвет фона"
      >
        <span className="bg-yellow-300 px-1 rounded">A</span>
      </button>
      <button type="button"
        className={BTN_STYLE}
        onClick={(e) => {
          e.stopPropagation()
          setColorPicker(p => p === 'color' ? null : 'color')
          setHlPicker(null)
        }}
        title="Цвет текста"
      >
        <span className="border-b-2 border-red-600 px-1">A</span>
      </button>
      {colorPicker === 'color' && (
        <div className="absolute z-[150] bg-white border border-slate-300 rounded-lg shadow-xl p-2 flex flex-wrap gap-1" style={{ top: 40, left: 0 }}>
          {FONT_COLORS.map((c) => (
            <button type="button"
              key={c}
              className="w-6 h-6 rounded border border-slate-300"
              style={{ backgroundColor: c }}
              onClick={() => {
                exec('setColor', c)
                setColorPicker(null)
              }}
            />
          ))}
        </div>
      )}
      {hlPicker === 'color' && (
        <div className="absolute z-[150] bg-white border border-slate-300 rounded-lg shadow-xl p-2 flex flex-wrap gap-1" style={{ top: 40, left: 0 }}>
          {HIGHLIGHT_COLORS.map((c) => (
            <button type="button"
              key={c}
              className="w-6 h-6 rounded border border-slate-300"
              style={{ backgroundColor: c }}
              onClick={() => {
                exec('toggleHighlight', { color: c })
                setHlPicker(null)
              }}
            />
          ))}
        </div>
      )}
      {SEPARATOR}
      {/* заголовки / текст */}
      {['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((tag, i) => (
        <button type="button"
          key={tag}
          className={BTN_STYLE}
          onClick={() => tag === 'p' ? exec('setParagraph') : exec('toggleHeading', { level: i })}
          title={tag === 'p' ? 'Обычный текст' : `Заголовок ${i}`}
        >
          {tag === 'p' ? '¶' : tag.toUpperCase()}
        </button>
      ))}
      {SEPARATOR}
      {/* списки / чекпоинт */}
      <button type="button" className={BTN_STYLE} onClick={() => exec('toggleBulletList')} title="Маркированный список">
        •
      </button>
      <button type="button" className={BTN_STYLE} onClick={() => exec('toggleOrderedList')} title="Нумерованный список">
        1.
      </button>
      <button type="button" className={BTN_STYLE} onClick={() => exec('toggleTaskList')} title="Чекпоинт">
        ☐
      </button>
      {SEPARATOR}
      {/* block */}
      <button type="button" className={BTN_STYLE} onClick={() => exec('toggleBlockquote')} title="Цитата">
        «
      </button>
      <button type="button" className={BTN_STYLE} onClick={() => exec('toggleCodeBlock')} title="Блок кода">
        {'</>'}
      </button>
      <button type="button" className={BTN_STYLE} onClick={() => insertText('`', '`')} title="Встроенный код">
        {`code`}
      </button>
      <button type="button" className={BTN_STYLE} onClick={() => exec('setHorizontalRule')} title="Разделитель">
        ―
      </button>
      {SEPARATOR}
      {/* media / insert */}
      <button type="button" className={BTN_STYLE} onClick={handleImage} title="Вставить изображение">
        🖼
      </button>
      <button type="button" className={BTN_STYLE} onClick={() => exec('setLink', { href: prompt('URL ссылки: ') || '#' })} title="Ссылка">
        🔗
      </button>
      <button type="button" className={BTN_STYLE} onClick={() => exec('insertTable', { rows: tableCols, cols: tableCols, withHeaderRow: false })} title="Таблица">
        🗒
      </button>
      <button type="button" className={BTN_STYLE} onClick={() => {
        setEmojiOpen(o => !o); setImgDialogOpen(false); setColorPicker(null); setHlPicker(null)
      }} title="Эмодзи">
        😊
      </button>
      <button type="button" className={BTN_STYLE} onClick={() => {
        exec('setCallout', 'note')
        setColorPicker(null); setHlPicker(null); setEmojiOpen(false)
      }} title="Заметка (callout)">
        💡
      </button>

      {/* emoji dropdown */}
      {emojiOpen && (
        <div className="absolute z-[150] bg-white border border-slate-300 rounded-lg shadow-xl p-2 w-64 h-64 overflow-y-auto grid grid-cols-8 gap-1">
          {emojis.map((e) => (
            <button type="button"
              key={e}
              className="text-xl hover:bg-slate-100 rounded p-1"
              onClick={() => {
                exec('insertContent', e)
                setEmojiOpen(false)
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* image dialog */}
      {imgDialogOpen && (
        <div className="absolute z-[150] bg-white border border-slate-300 rounded-lg shadow-xl p-4 min-w-[24rem]">
          <h4 className="font-semibold text-sm mb-2">Вставить изображение</h4>
          <input
            type="text"
            value={imgSrc}
            onChange={(e) => setImgSrc(e.target.value)}
            placeholder="https://..."
            className="w-full p-2 border rounded text-sm"
          />
          <div className="flex gap-2 mt-3">
            <button type="button" className="px-3 py-1.5 rounded bg-green-600 text-white text-sm" onClick={submitImage}>Вставить</button>
            <button type="button" className="px-3 py-1.5 rounded border border-slate-300 text-sm" onClick={() => setImgDialogOpen(false)}>Отмена</button>
          </div>
        </div>
      )}

      {/* table size picker inline */}
      <span className="text-[10px] text-slate-500 px-1 self-center">столбцов:</span>
      <input
        type="number"
        min="2"
        max="12"
        value={tableCols}
        onChange={(e) => setTableCols(Number(e.target.value) || 2)}
        className="w-10 p-1 border rounded text-xs text-center"
      />
    </div>
  )
}
