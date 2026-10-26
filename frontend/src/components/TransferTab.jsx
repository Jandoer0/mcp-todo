import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { boardsApi } from '../api/client'
import { formatApiError } from '../api/errors'

// Вкладка «Импорт / Экспорт» в свойствах доски: полный перенос всех задач
// доски (включая циклические — с настройками цикла и историей выполненных
// итераций) в JSON-файл и обратно. Экспорт скачивается файлом; импорт
// работает в двух режимах: «добавить» (merge) и «заменить» (replace).
export default function TransferTab({ board, onImported }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [mode, setMode] = useState('merge')
  const [pending, setPending] = useState(null) // { data, fileName }

  useEffect(() => {
    setError('')
    setResult(null)
    setPending(null)
    setMode('merge')
  }, [board?.id])

  if (!board) return null

  const doExport = async () => {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const res = await boardsApi.export(board.id)
      const blob = new Blob([JSON.stringify(res.data, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const safe = (board.name || 'board').replace(/[^\wа-яА-ЯёЁ-]+/g, '_')
      a.href = url
      a.download = `${safe}-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(formatApiError(e, t('transfer.exportError')))
    } finally {
      setBusy(false)
    }
  }

  const onFile = (e) => {
    const f = e.target.files?.[0]
    e.target.value = '' // позволяет выбрать тот же файл повторно
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result)
        if (data.format && data.format !== 'mcp-todo-board') {
          throw new Error('not-export')
        }
        if (!Array.isArray(data.tasks)) throw new Error('no-tasks')
        setPending({ data, fileName: f.name })
        setError('')
        setResult(null)
      } catch (err) {
        setPending(null)
        setError(
          err?.message === 'not-export'
            ? t('transfer.notExportFile')
            : err?.message === 'no-tasks'
              ? t('transfer.noTasksList')
              : t('transfer.readError'),
        )
      }
    }
    reader.onerror = () => setError(t('transfer.readErrorShort'))
    reader.readAsText(f)
  }

  const doImport = async () => {
    if (!pending) return
    if (
      mode === 'replace' &&
      !window.confirm(t('transfer.replaceConfirm', { name: board.name }))
    )
      return
    setBusy(true)
    setError('')
    try {
      const res = await boardsApi.importBoard(board.id, {
        data: pending.data,
        mode,
      })
      setResult(res.data)
      setPending(null)
      onImported?.()
    } catch (e) {
      setError(formatApiError(e, t('transfer.importError')))
    } finally {
      setBusy(false)
    }
  }

  const cyclicCount = pending ? pending.data.tasks.filter((t) => t.is_cyclic).length : 0
  const historyCount = pending ? (pending.data.cycle_history || []).length : 0

  return (
    <div className="space-y-5">
      {/* --- Экспорт ------------------------------------------------------- */}
      <section>
        <h4 className="text-sm font-semibold text-slate-700 mb-1">{t('transfer.export')}</h4>
        <p className="text-xs text-slate-500 mb-2">
          {t('transfer.exportHint')}
        </p>
        <button
          type="button"
          onClick={doExport}
          disabled={busy}
          className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 font-medium disabled:opacity-50"
        >
          {t('transfer.download')}
        </button>
      </section>

      {/* --- Импорт -------------------------------------------------------- */}
      <section>
        <h4 className="text-sm font-semibold text-slate-700 mb-1">{t('transfer.import')}</h4>
        <p className="text-xs text-slate-500 mb-2">
          {t('transfer.importHint')}
        </p>
        <label
          className={`inline-block border border-green-600 text-green-700 px-4 py-2 rounded hover:bg-green-50 font-medium cursor-pointer ${
            busy ? 'opacity-50 pointer-events-none' : ''
          }`}
        >
          {t('transfer.chooseFile')}
          <input type="file" accept=".json,application/json" onChange={onFile} className="hidden" />
        </label>

        {pending && (
          <div className="mt-3 border border-slate-200 rounded p-3 space-y-3">
            <p className="text-sm text-slate-700">
              {t('transfer.fileLabel')} <span className="font-medium">{pending.fileName}</span> —{' '}
              {t('transfer.tasksCount', { count: pending.data.tasks.length })}
              {cyclicCount > 0 && t('transfer.cyclicOf', { count: cyclicCount })}
              {historyCount > 0 && t('transfer.historyOf', { count: historyCount })}
            </p>
            <div className="space-y-1.5">
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={mode === 'merge'}
                  onChange={() => setMode('merge')}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">{t('transfer.mergeMode')}</span>
                  <span className="block text-xs text-slate-500">
                    {t('transfer.mergeHint')}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-red-500">{t('transfer.replaceMode')}</span>
                  <span className="block text-xs text-slate-500">
                    {t('transfer.replaceHint')}
                  </span>
                </span>
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={doImport}
                disabled={busy}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 font-medium disabled:opacity-50"
              >
                {t('transfer.importAction')}
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="px-4 py-2 text-gray-500 hover:text-gray-700"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="mt-3 border border-green-200 bg-green-50 rounded p-3 text-sm text-green-800">
            {t('transfer.resultLine', { tasks: result.tasks_created })}
            {result.lists_created > 0 && t('transfer.resultLists', { count: result.lists_created })}
            {result.tags_created > 0 && t('transfer.resultTags', { count: result.tags_created })}
            {result.history_imported > 0 && t('transfer.resultHistory', { count: result.history_imported })}
            {result.history_skipped > 0 && t('transfer.resultSkipped', { count: result.history_skipped })}
            .
          </div>
        )}
      </section>

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}
