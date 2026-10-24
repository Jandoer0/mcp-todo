import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Table from '@tiptap/extension-table'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import { Table as PMTable } from '@tiptap/pm/tables'
import { Callout } from './CalloutNode'
import { markdownToHtml, normalizeTaskLists } from '../../utils/markdown'
import Toolbar from './Toolbar'
import TableControls from './TableControls'

const extensions = [
  StarterKit.configure({
    bulletList: { keepMarks: true, keepAttributes: false },
    orderedList: { keepMarks: true, keepAttributes: false },
    taskList: { keepMarks: true, keepAttributes: false },
    taskItem: { keepMarks: true, keepAttributes: false },
    codeBlock: { keepMarks: true, keepAttributes: false },
  }),
  Underline.configure({ HTMLAttributes: { class: 'text-underline' } }),
  Highlight.configure({ multicolor: true }),
  TextStyle,
  Color,
  Link.configure({ openOnClick: false }),
  Image,
  TaskList,
  TaskItem.configure({
    HTMLAttributes: { class: 'flex items-start gap-2' },
  }),
  Table.configure({
    resizable: true,
    HTMLAttributes: { class: 'border border-slate-300 text-sm', style: 'border-collapse: collapse; width: 100%' },
  }),
  TableHeader,
  TableRow,
  TableCell,
  Callout.configure({
    HTMLAttributes: { class: 'callout' },
  }),
]

export default function MarkdownEditor({ initialValue = '', onChange }) {
  const [content, setContent] = useState(initialValue)
  const initialized = useRef(false)

  const editor = useEditor({
    extensions,
    content: null,
    autofocus: false,
    editorProps: {
      attributes: {
        class: 'prose prose-slate prose-sm focus:outline-none min-h-[6rem] p-2',
      },
    },
    onCreate({ editor }) {
      try {
        const html = markdownToHtml(initialValue)
        setContent(html)
        editor.commands.setContent(html)
      } catch (e) {
        console.error('Tiptap onCreate error:', e)
      }
    },
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML())
    },
  })

  if (!editor) return null

  return (
    <div className="flex flex-col gap-1">
      <Toolbar editor={editor} />
      <div className="border border-slate-300 rounded-lg bg-white">
        <EditorContent editor={editor} />
      </div>
      <TableControls editor={editor} />
    </div>
  )
}
