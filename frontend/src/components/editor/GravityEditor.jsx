import { useCallback, useEffect, useRef, useState } from 'react'
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
 * Markdown-редактор @gravity-ui/markdown-editor. Wrapper с явными
 * minHeight/maxHeight растягивается/сжимается в этих пределах (drag-resize
 * ручка внизу), тулбар имеет непрозрачный фон. Конкретные значения задаёт
 * вызывающая форма (TaskForm: 150..450px, CyclicTaskForm: то же).
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

  // Ручка изменения высоты (drag-resize): тасовать вниз/вверх за нижнюю границу
  // wrapper редактора, удерживая высоту в пределах [minHeight, maxHeight].
  // resizeRef — сама полоска-ручка (чтобы курсор был ns-resize), wrapperRef —
  // wrapper редактора: именно его высоту мы меняем. Работает и по мыши, и по
  // касанию (touch — важно для мобильной версии).
  const resizeMove = useRef(null)
  const resizeUp = useRef(null)
  const resizeRef = useRef(null)

  const startResize = (e) => {
    if (e.type === 'mousedown' && e.button !== 0) return
    e.preventDefault()
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    const startH = wrapperRef.current.getBoundingClientRect().height
    resizeMove.current = (ev) => {
      if (!resizeRef.current) return
      ev.preventDefault()
      const clientY2 = ev.touches ? ev.touches[0].clientY : ev.clientY
      const next = Math.max(
        computedMinHeight,
        Math.min(computedMaxHeight, startH + clientY2 - clientY),
      )
      wrapperRef.current.style.height = next + 'px'
    }
    resizeUp.current = () => {
      window.removeEventListener('mousemove', resizeMove.current)
      window.removeEventListener('mouseup', resizeUp.current)
      window.removeEventListener('touchmove', resizeMove.current)
      window.removeEventListener('touchend', resizeUp.current)
    }
    window.addEventListener('mousemove', resizeMove.current)
    window.addEventListener('mouseup', resizeUp.current)
    window.addEventListener('touchmove', resizeMove.current, { passive: false })
    window.addEventListener('touchend', resizeUp.current)
  }

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
        style={{ minHeight: computedMinHeight, maxHeight: computedMaxHeight, display: 'flex', flexDirection: 'column' }}
      >
        {/* Ручка изменения высоты: тонкая полоска внизу окна описания.
            Перетаскивание меняет высоту wrapper редактора в пределах
            minHeight/maxHeight. */}
        <div
          ref={resizeRef}
          onMouseDown={startResize}
          onTouchStart={startResize}
          onMouseUp={resizeUp.current}
          onTouchEnd={resizeUp.current}
          className="h-1.5 w-full cursor-ns-resize hover:bg-slate-400 active:bg-slate-500 bg-slate-300/70 transition-colors"
          title="Перетащите, чтобы изменить высоту окна описания"
        />
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
