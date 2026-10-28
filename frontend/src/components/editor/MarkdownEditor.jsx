import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

// Собственный тонкий markdown-редактор: тулбар + <textarea>.
// Решает ровно три проблемы сторонних WYSIWYG (Gravity UI):
//  - фон тулбара непрозрачный по построению (обычный div с bg-white);
//  - тулбар не уезжает при прокрутке — он вне зоны скролла (flex-колонка,
//    textarea flex-1 overflow-y-auto, полоса прокрутки всегда видна);
//  - изменение высоты — нативный CSS resize:vertical на textarea: браузер
//    рисует уголок ↘ в правом нижнем углу поля ввода, он жёстко зафиксирован
//    и работает мышью и пальцем без единой строки JS.
// Кнопки оборачивают выделение markdown-синтаксисом прямо в value.

/** Обернуть выделение префиксом/суффиксом (или заменить целиком). */
function wrapSelection(ta, before, after = before, placeholder = '') {
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const val = ta.value
  const sel = val.slice(start, end) || placeholder
  const next = val.slice(0, start) + before + sel + after + val.slice(end)
  ta.value = next
  // Курсор — внутрь обернутого фрагмента.
  const caret = start + before.length
  ta.setSelectionRange(caret, caret + sel.length)
  ta.focus()
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Префикс каждой строки выделения (# , -, 1. и т.п.). */
function prefixLines(ta, makePrefix) {
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const val = ta.value
  const lineStart = val.lastIndexOf('\n', start - 1) + 1
  const lineEnd = val.indexOf('\n', end) === -1 ? val.length : val.indexOf('\n', end)
  const block = val.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const out = lines.map((ln, i) => makePrefix(ln, i)).join('\n')
  ta.value = val.slice(0, lineStart) + out + val.slice(lineEnd)
  ta.setSelectionRange(lineStart, lineStart + out.length)
  ta.focus()
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}

export default function MarkdownEditor({ initialValue = '', onChange, minHeight = 150, maxHeight = 450 }) {
  const { t } = useTranslation()
  const taRef = useRef(null)

  const act = (fn) => () => { if (taRef.current) fn(taRef.current) }

  const buttons = [
    { label: 'B', title: t('editor.bold'), cls: 'font-bold', onClick: act((ta) => wrapSelection(ta, '**', '**', t('editor.text'))) },
    { label: 'I', title: t('editor.italic'), cls: 'italic', onClick: act((ta) => wrapSelection(ta, '*', '*', t('editor.text'))) },
    { label: 'S', title: t('editor.strike'), cls: 'line-through', onClick: act((ta) => wrapSelection(ta, '~~', '~~', t('editor.text'))) },
    { sep: true },
    { label: '<>', title: t('editor.code'), mono: true, onClick: act((ta) => wrapSelection(ta, '`', '`', t('editor.text'))) },
    { label: '{}', title: t('editor.codeBlock'), mono: true, onClick: act((ta) => wrapSelection(ta, '\n```\n', '\n```\n', '')) },
    { sep: true },
    { label: '🔗', title: t('editor.link'), onClick: act((ta) => wrapSelection(ta, '[', `](${''})`, t('editor.text'))) },
    { sep: true },
    { label: 'H1', title: t('editor.heading1'), onClick: act((ta) => prefixLines(ta, (ln) => ln.replace(/^#{1,6}\s*/, '').length ? '# ' + ln.replace(/^#{1,6}\s*/, '') : ln)) },
    { label: 'H2', title: t('editor.heading2'), onClick: act((ta) => prefixLines(ta, (ln) => ln.replace(/^#{1,6}\s*/, '').length ? '## ' + ln.replace(/^#{1,6}\s*/, '') : ln)) },
    { sep: true },
    { label: '•—', title: t('editor.bulletList'), onClick: act((ta) => prefixLines(ta, (ln) => '- ' + ln.replace(/^[-*+]\s*/, ''))) },
    { label: '1.', title: t('editor.numberedList'), onClick: act((ta) => prefixLines(ta, (ln, i) => `${i + 1}. ` + ln.replace(/^\d+\.\s*/, ''))) },
    { label: '☑', title: t('editor.checklist'), onClick: act((ta) => prefixLines(ta, (ln) => '- [ ] ' + ln.replace(/^- \[[ xX]\]\s*/, ''))) },
    { sep: true },
    { label: '"', title: t('editor.quote'), cls: 'font-serif', onClick: act((ta) => prefixLines(ta, (ln) => '> ' + ln.replace(/^>\s*/, ''))) },
  ]

  return (
    <div className="border border-slate-300 rounded-lg bg-white flex flex-col overflow-hidden">
      {/* Тулбар: непрозрачный белый фон, вне зоны скролла — никогда не уезжает. */}
      <div className="shrink-0 flex flex-wrap items-center gap-0.5 px-1.5 py-1 bg-white border-b border-slate-200">
        {buttons.map((b, i) =>
          b.sep ? (
            <span key={`sep${i}`} className="mx-1 h-4 w-px bg-slate-300" />
          ) : (
            <button
              key={b.title}
              type="button"
              onMouseDown={(e) => e.preventDefault()} // не терять выделение в textarea
              onClick={b.onClick}
              title={b.title}
              aria-label={b.title}
              className={`min-w-[26px] h-6 px-1 rounded text-xs text-slate-600 hover:bg-slate-100 active:bg-slate-200 transition-colors ${b.cls || ''} ${b.mono ? 'font-mono' : ''}`}
            >
              {b.label}
            </button>
          ),
        )}
      </div>
      {/* Поле ввода: собственный вертикальный скролл (полоса всегда видна)
          и нативный уголок изменения высоты в правом нижнем углу. */}
      <textarea
        ref={taRef}
        defaultValue={initialValue}
        onInput={(e) => onChange(e.target.value)}
        placeholder={t('editor.placeholder')}
        spellCheck={false}
        className="w-full px-3 py-2 text-sm text-slate-800 bg-white resize-y outline-none overflow-y-auto leading-relaxed"
        style={{ height: minHeight, minHeight, maxHeight }}
      />
    </div>
  )
}
