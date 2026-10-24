import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Расширение marked: ==текст== → <mark> (подчёркивание, как раньше в Markdown.jsx).
const highlightExtension = {
  name: 'highlight',
  level: 'inline',
  start(src) { return src.indexOf('==') },
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

/**
 * markdown → HTML (без санитизации — используется для загрузки в редактор,
 * где ProseMirror-схема сама отфильтрует лишнее).
 */
export function markdownToHtml(md) {
  return marked.parse(String(md || ''), { breaks: true, gfm: true })
}

/**
 * markdown →_sanitized_ HTML (для отображения вне редактора: предпросмотр,
 * экспорты, отчёты).
 */
export function renderMarkdown(md) {
  if (!md) return ''
  const html = marked.parse(String(md), { breaks: true, gfm: true })
  return DOMPurify.sanitize(html).replace(/(<input[^>]*?)\s+disabled(="")?/g, '$1')
}

/**
 * HTML (marked) → HTML, пригодный для setContent редактора:
 * преобразует GFM-список с чекбоксами в формат Tiptap (taskList/taskItem).
 */
export function normalizeTaskLists(html) {
  if (!html) return html
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  let changed = false
  doc.querySelectorAll('ul').forEach((ul) => {
    const items = Array.from(ul.querySelectorAll(':scope > li'))
    const hasCheck = items.some((li) => li.querySelector(':scope > input[type="checkbox"]'))
    if (!hasCheck) return
    ul.setAttribute('data-type', 'taskList')
    let body = ''
    items.forEach((li) => {
      const input = li.querySelector(':scope > input[type="checkbox"]')
      if (!input) {
        body += li.outerHTML
        return
      }
      changed = true
      const checked = input.hasAttribute('checked')
      const inner = li.innerHTML.replace(input.outerHTML, '').replace(/<br>/g, ' ').trim()
      body += `<li data-type="taskItem" data-checked="${checked}">${inner}</li>`
    })
    if (changed) ul.outerHTML = '<ul data-type="taskList">' + body + '</ul>'
  })
  return doc.body.innerHTML
}

/**
 * HTML → markdown: турндаун для всего, кроме `div.callout` (они сохраняются
 * как «сырой» HTML — блок без внутренних пустых строк, чтобы marked
 * провёл их единым блоком и загрузчик распознал parse-правилом).
 */
export function htmlToMarkdown(html) {
  if (!html) return ''
  const TurndownService = (() => { try { return require('turndown') } catch { return null } })()
  if (!TurndownService) {
    console.error('turndown недоступен — markdown-экспорт недоступен')
    return ''
  }
  const { tables, strikethrough } = require('turndown-plugin-gfm')
  const td = new TurndownService.TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
  td.use([tables, strikethrough])
  td.addRule('stripLabel', { filter: ['label', 'span', 'input'], replacement: () => '' })
  td.addRule('taskItem', {
    filter: (n) => n.nodeName === 'LI' && n.getAttribute('data-type') === 'taskItem',
    replacement: (c, n) => (n.getAttribute('data-checked') === 'true' ? '- [x] ' : '- [ ] ') + c.replace(/^\s+/, ''),
  })
  td.addRule('underline', { filter: 'u', replacement: (c) => `<u>${c}</u>` })
  td.addRule('highlight', {
    filter: 'mark',
    replacement: (c, n) => (n.getAttribute('style') ? `<mark style="${n.getAttribute('style')}">${c}</mark>` : `==${c}==`),
  })
  td.addRule('colorSpan', {
    filter: (n) => n.tagName === 'SPAN' && n.getAttribute('style')?.includes('color'),
    replacement: (c, n) => `<span style="${n.getAttribute('style')}">${c}</span>`,
  })
  td.keep((node) => node.nodeName === 'DIV' && node.classList.contains('callout'))
  return td.turndown(html)
}
