import { useCallback, useEffect, useRef } from 'react'
import { useMarkdownEditor, MarkdownEditorView } from '@gravity-ui/markdown-editor'

// Пресет панелей из Planka — удаляем лишние элементы (checkbox/file/tabs)
import { full as toolbarsPreset } from '@gravity-ui/markdown-editor/_/modules/toolbars/presets'
import { ActionName } from '@gravity-ui/markdown-editor/_/bundle/config/action-names'

const removedActionNamesSet = new Set([
  ActionName.checkbox,
  ActionName.file,
  ActionName.filePopup,
  ActionName.tabs,
])

removedActionNamesSet.forEach((actionName) => {
  delete toolbarsPreset.items[actionName]
  Object.entries(toolbarsPreset.orders).forEach(([orderName, order]) => {
    order.forEach((actions, actionsIndex) => {
      toolbarsPreset.orders[orderName][actionsIndex] = actions.filter(
        (action) => action.id || action !== actionName,
      )
    })
  })
})

const commandMenuActions = toolbarsPreset.items.wCommandMenu
  ? toolbarsPreset.items.wCommandMenu.filter(
      (action) => !removedActionNamesSet.has(action.id),
    )
  : []

export function GravityEditor({ initialValue = '', onChange }) {
  const wrapperRef = useRef(null)

  const editor = useMarkdownEditor({
    md: {
      breaks: true,
      linkify: true,
      linkifyTlds: null,
    },
    markupConfig: {
      searchPanel: false,
    },
    wysiwygConfig: {
      extensionOptions: {
        commandMenu: {
          actions: commandMenuActions,
        },
      },
      searchPanel: false,
    },
    initial: {
      markup: initialValue,
      mode: 'markup', // только Markdown режим
    },
  })

  const handleChange = useCallback(() => {
    onChange(editor.getValue() || '')
  }, [onChange, editor])

  useEffect(() => {
    editor.on('change', handleChange)
    return () => {
      editor.off('change', handleChange)
    }
  }, [handleChange, editor])

  useEffect(() => {
    if (wrapperRef.current) {
      const handlePaste = (e) => {
        e.stopPropagation()
      }
      wrapperRef.current.addEventListener('paste', handlePaste)
      return () => {
        wrapperRef.current.removeEventListener('paste', handlePaste)
      }
    }
  }, [])

  // Сброс редактора при смене initialValue (открытие формы редактирования)
  useEffect(() => {
    editor.setValue(initialValue || '')
  }, [initialValue, editor])

  return (
    <div
      ref={wrapperRef}
      className="border border-slate-300 rounded-lg bg-white overflow-hidden"
    >
      <MarkdownEditorView
        editor={editor}
        toolbarsPreset={toolbarsPreset}
        className="g-md-wysiwyg-editor"
      />
    </div>
  )
}

export default GravityEditor
