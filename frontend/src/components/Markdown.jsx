import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Markdown → sanitized HTML. Used for task descriptions; supports headers,
// bold/italic, lists, links, code, blockquotes.
export function renderMarkdown(text) {
  if (!text) return ''
  const html = marked.parse(String(text), { breaks: true, gfm: true })
  return DOMPurify.sanitize(html)
}

// Inline component: renders markdown inside a styled prose-like container.
export default function Markdown({ text, className = '' }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  if (!html) return null
  return (
    <div
      className={`text-sm leading-relaxed text-slate-700 break-words ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
