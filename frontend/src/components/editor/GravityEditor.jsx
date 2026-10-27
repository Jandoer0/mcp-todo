import { useCallback, useEffect, useRef } from 'react'
import { ThemeProvider, ToasterProvider } from '@gravity-ui/uikit'
import { toaster as sharedToaster } from '@gravity-ui/uikit/toaster-singleton'
import { useMarkdownEditor, MarkdownEditorView } from '@gravity-ui/markdown-editor'

// Тема и шрифты Gravity UI: всплывающие панели редактора (dropdown-меню
// тулбара, командное меню, tooltip'ы) рисуются на g-color-* переменных.
// Без импорта темы переменные не определены — панели теряют непрозрачный
// фон и выглядят «прозрачными» на цветном фоне приложения.
// CSS импортируется из JS (не из постcss @import) — так vite гарантированно
// включает его в сборку.
import '@gravity-ui/uikit/styles/styles.css'
import '@gravity-ui/uikit/styles/fonts.css'

// Пресет панелей из Planka — удаляем лишние элементы (checkbox/file/tabs)
import { full as toolbarsPreset } from '@gravity-ui/markdown-editor/_/modules/toolbars/presets'
import { ActionName } from '@gravity-ui/markdown-editor/_/bundle/config/action-names'
import { ToolbarName } from '@gravity-ui/markdown-editor/_/modules/toolbars/constants'

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

// Отключаем всплывающую панель при выделении текста (wysiwygSelection):
// она дублирует кнопки основной панели и закрывает текст.
toolbarsPreset.orders[ToolbarName.wysiwygSelection] = []

/**
 * Markdown-редактор @gravity-ui/markdown-editor. Отличается от TaskForm: получает
 // minHeight/maxHeight — высота окна ввода описания «растягивается» (ограничена
 // maxHeight). minHeight/minHeight (ТЗ): окно не меньше 120px, не больше 400px.
 */
export function GravityEditor({ initialValue = '', onChange, minHeight = 120, maxHeight = 400 }) {

const commandMenuActions = toolbarsPreset.items.wCommandMenu
  ? toolbarsPreset.items.wCommandMenu.filter(
      (action) => !removedActionNamesSet.has(action.id),
    )
  : []

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
      mode: 'wysiwyg', // визуальный режим по умолчанию (переключение доступно в панели)
    },
  })

  const handleChange = useCallback(() => {
    onChange(editor.getValue() || '')
  }, [onChange, editor])

  const computedMinHeight = typeof minHeight === 'number' ? minHeight : 120
  const computedMaxHeight = typeof maxHeight === 'number' ? maxHeight : 400

  useEffect(() => {
    editor.on('change', handleChange)
    return () => {
      editor.off('change', handleChange)
    }
  }, [handleChange, editor])



  // Сброс редактора при смене initialValue (открытие формы редактирования)
  useEffect(() => {
    editor.replace(initialValue || '')
  }, [initialValue, editor])

  return (
    <ThemeProvider theme="light">
    <ToasterProvider toaster={sharedToaster}>
      <div
        ref={wrapperRef}
        className="g-markdown-editor-own-wrapper border border-slate-300 rounded-lg bg-white overflow-hidden"
        style={{ minHeight: computedMinHeight, maxHeight: computedMaxHeight }}
      >
        <MarkdownEditorView
          editor={editor}
          toolbarsPreset={toolbarsPreset}
          className="g-md-wysiwyg-editor"
        />
      </div>
    </ToasterProvider>
    </ThemeProvider>
  )
}

export default GravityEditor
