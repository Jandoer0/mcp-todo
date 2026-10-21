import { useEffect, useState } from 'react'
import { boardsApi } from '../api/client'
import { formatApiError } from '../api/errors'

// Вкладка «Импорт / Экспорт» в свойствах доски: полный перенос всех задач
// доски (включая циклические — с настройками цикла и историей выполненных
// итераций) в JSON-файл и обратно. Экспорт скачивается файлом; импорт
// работает в двух режимах: «добавить» (merge) и «заменить» (replace).
export default function TransferTab({ board, onImported }) {
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
      setError(formatApiError(e, 'Ошибка экспорта'))
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
          throw new Error('Это не файл экспорта доски')
        }
        if (!Array.isArray(data.tasks)) throw new Error('В файле нет списка задач')
        setPending({ data, fileName: f.name })
        setError('')
        setResult(null)
      } catch (err) {
        setPending(null)
        setError(
          err?.message === 'Это не файл экспорта доски' || err?.message === 'В файле нет списка задач'
            ? err.message
            : 'Не удалось прочитать файл: ожидается JSON экспорта доски',
        )
      }
    }
    reader.onerror = () => setError('Не удалось прочитать файл')
    reader.readAsText(f)
  }

  const doImport = async () => {
    if (!pending) return
    if (
      mode === 'replace' &&
      !window.confirm(
        `Заменить содержимое доски «${board.name}»? Текущие задачи, теги и история итераций будут удалены.`,
      )
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
      setError(formatApiError(e, 'Ошибка импорта'))
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
        <h4 className="text-sm font-semibold text-slate-700 mb-1">Экспорт</h4>
        <p className="text-xs text-slate-500 mb-2">
          Скачивает полный снимок доски: все задачи (включая циклические — с настройками
          цикла, суммами и историей выполненных итераций), списки, теги и блокеры.
          Файл можно импортировать на любую свою доску.
        </p>
        <button
          type="button"
          onClick={doExport}
          disabled={busy}
          className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 font-medium disabled:opacity-50"
        >
          Скачать файл экспорта
        </button>
      </section>

      {/* --- Импорт -------------------------------------------------------- */}
      <section>
        <h4 className="text-sm font-semibold text-slate-700 mb-1">Импорт</h4>
        <p className="text-xs text-slate-500 mb-2">
          Выберите ранее скачанный JSON-файл. Списки и теги сопоставляются по именам,
          валюты — по коду; недостающие будут созданы.
        </p>
        <label
          className={`inline-block border border-green-600 text-green-700 px-4 py-2 rounded hover:bg-green-50 font-medium cursor-pointer ${
            busy ? 'opacity-50 pointer-events-none' : ''
          }`}
        >
          Выбрать файл…
          <input type="file" accept=".json,application/json" onChange={onFile} className="hidden" />
        </label>

        {pending && (
          <div className="mt-3 border border-slate-200 rounded p-3 space-y-3">
            <p className="text-sm text-slate-700">
              Файл: <span className="font-medium">{pending.fileName}</span> —{' '}
              {pending.data.tasks.length} задач
              {cyclicCount > 0 && `, из них циклических: ${cyclicCount}`}
              {historyCount > 0 && `, история итераций: ${historyCount}`}
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
                  <span className="font-medium">Добавить к доске</span>
                  <span className="block text-xs text-slate-500">
                    Существующие задачи останутся; факты истории дубликаты пропускают.
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
                  <span className="font-medium text-red-500">Заменить содержимое</span>
                  <span className="block text-xs text-slate-500">
                    Текущие задачи, теги и история итераций доски будут удалены.
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
                Импортировать
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="px-4 py-2 text-gray-500 hover:text-gray-700"
              >
                Отмена
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="mt-3 border border-green-200 bg-green-50 rounded p-3 text-sm text-green-800">
            Импорт завершён: создано задач — {result.tasks_created}
            {result.lists_created > 0 && `, списков — ${result.lists_created}`}
            {result.tags_created > 0 && `, тегов — ${result.tags_created}`}
            {result.history_imported > 0 && `, записей истории — ${result.history_imported}`}
            {result.history_skipped > 0 && ` (пропущено дублей истории — ${result.history_skipped})`}
            .
          </div>
        )}
      </section>

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}
