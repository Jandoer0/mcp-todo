import { BOARD_PALETTE, MAX_BOARDS } from '../constants'
import Modal from './Modal'
import BudgetView from './BudgetView'
import WebhookTab from './WebhookTab'
import TransferTab from './TransferTab'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatApiError } from '../api/errors'

// Edit/create dialog for a board (name, multiline description, color).
// In edit mode extra tabs show the board's financial summary («Бюджет» —
// объединённая вкладка «Итоги/График», ТЗv2 §4), its single webhook
// («Веб-хуки», only when allowed for the user) and the full board transfer
// («Импорт / Экспорт»). Управление списками — кнопка «Списки» в шапке доски.
export default function BoardForm({ open, board, boardsCount, tasks = [], lists = [], webhooksEnabled = true, maxBoards = MAX_BOARDS, onImported, onChanged, onClose, onSubmit, onDelete }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(BOARD_PALETTE[1])
  const [error, setError] = useState('')
  const [tab, setTab] = useState('general')

  useEffect(() => {
    if (open) {
      setName(board?.name || '')
      setDescription(board?.description || '')
      setColor(board?.color || BOARD_PALETTE[1])
      setError('')
      setTab('general')
    }
  }, [open, board])

  if (!open) return null
  const isEdit = !!board

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) {
      setError(t('boards.needName'))
      return
    }
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || null,
        color,
      })
    } catch (err) {
      setError(formatApiError(err, t('boards.saveError')))
    }
  }

  const remove = async () => {
    if (!window.confirm(t('boards.deleteConfirm', { name: board.name }))) return
    try {
      await onDelete(board)
    } catch (err) {
      setError(formatApiError(err, t('boards.deleteError')))
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? t('boards.editTitle') : t('boards.createTitle')}>
      {isEdit && (
        <div className="flex gap-1 mb-4 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setTab('general')}
            className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === 'general'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t('boards.tabGeneral')}
          </button>
          <button
            type="button"
            onClick={() => setTab('budget')}
            className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === 'budget'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t('boards.tabBudget')}
          </button>
          {webhooksEnabled && (
            <button
              type="button"
              onClick={() => setTab('webhooks')}
              className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
                tab === 'webhooks'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t('boards.tabWebhooks')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setTab('transfer')}
            className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === 'transfer'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t('boards.tabTransfer')}
          </button>
        </div>
      )}

      {tab === 'webhooks' ? (
        <WebhookTab board={board} />
      ) : tab === 'budget' ? (
        <BudgetView board={board} tasks={tasks} lists={lists} onChanged={onChanged} />
      ) : tab === 'transfer' ? (
        <TransferTab board={board} onImported={onImported} />
      ) : (
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">{t('boards.name')}</label>
          <input
            type="text"
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            className="w-full p-2 border rounded"
            placeholder={t('boards.namePlaceholder')}
            required
            autoFocus
          />
          <p className="text-[10px] text-gray-500 mt-1">{t('boards.nameHint')}</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('boards.desc')}</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full p-2 border rounded"
            rows={3}
            placeholder={t('boards.descPlaceholder')}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('boards.color')}</label>
          <div className="flex flex-wrap gap-1.5">
            {BOARD_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full transition-transform ${
                  color === c ? 'ring-2 ring-offset-2 ring-slate-500 scale-110' : ''
                }`}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!isEdit && boardsCount >= maxBoards && (
          <p className="text-sm text-red-500">{t('boards.limit', { max: maxBoards })}</p>
        )}
        <div className="flex items-center gap-2 pt-2">
          {isEdit && (
            <button
              type="button"
              onClick={remove}
              className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 mr-auto"
            >
              {t('common.delete')}
            </button>
          )}
          <button type="button" onClick={onClose} className="px-4 py-2 text-gray-500 hover:text-gray-700">
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={!isEdit && boardsCount >= maxBoards}
            className="bg-green-600 text-white px-5 py-2 rounded hover:bg-green-700 font-medium disabled:opacity-50"
          >
            {t('common.save')}
          </button>
        </div>
      </form>
      )}
    </Modal>
  )
}
