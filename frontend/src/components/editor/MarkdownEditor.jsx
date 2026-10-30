import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MDXEditor,
  toolbarPlugin,
  listsPlugin,
  quotePlugin,
  headingsPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  InsertTable,
  markdownShortcutPlugin,
  BoldItalicUnderlineToggles,
  StrikeThroughSupSubToggles,
  ListsToggle,
  CreateLink,
  BlockTypeSelect,
  UndoRedo,
  Separator,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'

// WYSIWYG-редактор описания задачи на @mdxeditor/editor (Lexical).
// Layout контролируется нами: flex-колонка фиксированной высоты — тулбар
// shrink-0 с непрозрачным белым фоном поверх области редактирования, которая
// скроллится сама (полоса прокрутки всегда видна, тулбар не уезжает).
// Изменение высоты — нативный CSS-ресайз (resize: vertical) самого wrapper'а:
// уголок выглядит точно так же, как у <textarea> в форме доски (BoardForm),
// и работает во всех современных браузерах без JS-драга.

// Русские подписи тулбара/диалогов MDXEditor (перевод встроенного EN-дефолта;
// ключи соответствуют t("…", "default") внутри библиотеки).
const ruDictionary = {
  'toolbar.bold': 'Жирный',
  'toolbar.removeBold': 'Убрать жирный',
  'toolbar.italic': 'Курсив',
  'toolbar.removeItalic': 'Убрать курсив',
  'toolbar.underline': 'Подчёркнутый',
  'toolbar.removeUnderline': 'Убрать подчёркивание',
  'toolbar.strikethrough': 'Зачёркнутый',
  'toolbar.removeStrikethrough': 'Убрать зачёркивание',
  'toolbar.subscript': 'Нижний индекс',
  'toolbar.removeSubscript': 'Убрать нижний индекс',
  'toolbar.superscript': 'Верхний индекс',
  'toolbar.removeSuperscript': 'Убрать верхний индекс',
  'toolbar.bulletedList': 'Маркированный список',
  'toolbar.numberedList': 'Нумерованный список',
  'toolbar.checkList': 'Чек-лист',
  'toolbar.link': 'Вставить ссылку',
  'toolbar.table': 'Вставить таблицу',
  'toolbar.undo': 'Отменить',
  'toolbar.redo': 'Вернуть',
  'toolbar.blockTypeSelect.placeholder': 'Блок',
  'toolbar.blockTypeSelect.selectBlockTypeTooltip': 'Выбрать тип блока',
  'toolbar.blockTypes.paragraph': 'Абзац',
  'toolbar.blockTypes.quote': 'Цитата',
  'toolbar.blockTypes.heading': 'Заголовок {{level}}',
  'createLink.text': 'Текст ссылки',
  'createLink.url': 'URL',
  'createLink.title': 'Название (подсказка)',
  'dialogControls.save': 'Сохранить',
  'dialogControls.cancel': 'Отмена',
}

export default function MarkdownEditor({ initialValue = '', onChange, minHeight = 150, maxHeight = 450 }) {
  const { t } = useTranslation()
  const editorRef = useRef(null)
  // Контейнер для попапов/диалогов MDXEditor (Radix Portal). По умолчанию
  // библиотека рендерит их в document.body — под нашей модалкой задачи
  // (z-[120]) и вне её границ. Пробрасываем свой div внутри wrapper'а:
  // селектор блоков открывается над тулбаром, диалог ссылки — поверх формы.
  const [overlayEl, setOverlayEl] = useState(null)

  // Сброс содержимого при открытии другой задачи (markdown controlled извне).
  useEffect(() => {
    if (editorRef.current) editorRef.current.setMarkdown(initialValue || '')
  }, [initialValue])

  return (
    <div
      className="relative border border-slate-300 rounded-lg bg-white flex flex-col overflow-hidden omni-md-wrapper"
      style={{ height: `${minHeight}px`, minHeight: `${minHeight}px`, maxHeight: `${maxHeight}px` }}
      title={t('editor.resizeHint')}
    >
      {/* Портал попапов/диалогов: внутри wrapper'а, над тулбаром и полем. */}
      <div ref={setOverlayEl} className="omni-md-overlay absolute inset-0 pointer-events-none" />
      <MDXEditor
        ref={editorRef}
        markdown={initialValue || ''}
        onChange={(md, normalized) => {
          // normalized=true — автоформат начального markdown при монтировании;
          // его не сохраняем, иначе описание перепишется само по себе.
          if (!normalized) onChange(md)
        }}
        translation={(key, defaultValue, interpolations) => {
          let s = ruDictionary[key] ?? defaultValue
          if (interpolations) {
            Object.entries(interpolations).forEach(([k, v]) => {
              s = s.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), String(v))
            })
          }
          return s
        }}
        overlayContainer={overlayEl}
        contentEditableClassName="omni-md-content"
        placeholder={t('editor.placeholder')}
        plugins={[
          headingsPlugin({ allowedHeadingLevels: [1, 2, 3] }),
          listsPlugin(),
          quotePlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          tablePlugin(),
          markdownShortcutPlugin(),
          toolbarPlugin({
            toolbarContents: () => (
              <>
                <UndoRedo />
                <Separator />
                <BlockTypeSelect />
                <Separator />
                <BoldItalicUnderlineToggles />
                <StrikeThroughSupSubToggles />
                <Separator />
                <ListsToggle />
                <Separator />
                <CreateLink />
                <Separator />
                <InsertTable />
              </>
            ),
          }),
        ]}
      />
    </div>
  )
}
