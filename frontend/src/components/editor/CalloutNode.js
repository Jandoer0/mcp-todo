import { Node, mergeAttributes } from '@tiptap/core'

const TONES = {
  note: { label: 'Заметка', emoji: '💡', class: 'callout-note' },
  warning: { label: 'Предупреждение', emoji: '⚠', class: 'callout-warning' },
  info: { label: 'Инфо', emoji: 'ℹ️', class: 'callout-info' },
  success: { label: 'Успех', emoji: '✅', class: 'callout-success' },
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'paragraph+',
  draggable: true,
  isolating: true,
  addAttributes() {
    return {
      tone: { default: 'note', parsed: (el) => (el.getAttribute('data-callout-type') || 'note') },
    }
  },
  parseHTML() {
    return [{ tag: 'div.callout', getAttrs: (el) => ({ tone: el.getAttribute('data-callout-type') || 'note' }) }]
  },
  renderHTML({ HTMLAttributes }) {
    const t = TONES[HTMLAttributes.tone] || TONES.note
    return [
      'div',
      mergeAttributes({ 'data-callout-type': HTMLAttributes.tone, class: `callout ${t.class}` }),
      ['span', { class: 'callout-emoji', 'aria-hidden': 'true' }, t.emoji],
      0,
    ]
  },
  addCommands() {
    return {
      setCallout:
        (tone = 'note') =>
        ({ commands }) => {
          return commands.setNode(this.name, { tone })
        },
      unsetCallout:
        () => ({
          commands,
        }) => {
          return commands.lift(this.name)
        },
    }
  },
  addKeyboardShortcuts() {
    return {}
  },
})
