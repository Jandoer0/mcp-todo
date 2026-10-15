import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Highlight-разметка: ==текст== → <mark> (жёлтый фон через CSS .markdown-body mark).
const highlightExtension = {
  name: 'highlight',
  level: 'inline',
  start(src) {
    return src.indexOf('==')
  },
  tokenizer(src) {
    const match = /^==(?![\s=])((?:[^=]|=(?!=))+?)==(?!=)/.exec(src)
    if (match) {
      return { type: 'highlight', raw: match[0], tokens: this.lexer.inlineTokens(match[1]) }
    }
  },
  renderer(token) {
    return `<mark>${this.parser.parseInline(token.tokens)}</mark>`
  },
}

marked.use({ extensions: [highlightExtension] })

// Markdown → sanitized HTML. Used for task descriptions; supports headers,
// bold/italic, lists, links, code, blockquotes, ==highlight==.
export function renderMarkdown(text) {
  if (!text) return ''
  const html = marked.parse(String(text), { breaks: true, gfm: true })
  const clean = DOMPurify.sanitize(html)
  // GFM task-list checkboxes render as `disabled` — remove the attribute so
  // they can be toggled interactively in preview mode (see Markdown onToggle).
  return clean.replace(/(<input[^>]*?)\s+disabled(="")?/g, '$1')
}

// Inline component: renders markdown inside a styled prose-like container.
// With onToggleCheckItem, clicking a task-list checkbox (- [ ] / - [x]) calls
// back with (index, checked) so the caller can persist the new state.
export default function Markdown({ text, className = '', onToggleCheckItem }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  if (!html) return null
  const handleClick = (e) => {
    if (!onToggleCheckItem) return
    const target = e.target
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return
    e.preventDefault()
    const boxes = Array.from(
      e.currentTarget.querySelectorAll('input[type=checkbox]')
    )
    const index = boxes.indexOf(target)
    if (index !== -1) {
      // Браузер переключает checked ДО dispatch'а click, поэтому состояние
      // после клика — это target.checked (preventDefault откатит визуально,
      // но новое состояние вернётся с ре-рендером из нового текста).
      onToggleCheckItem(index, target.checked)
    }
  }
  return (
    <div
      className={`markdown-body text-sm leading-relaxed text-slate-700 break-words ${className}`}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
