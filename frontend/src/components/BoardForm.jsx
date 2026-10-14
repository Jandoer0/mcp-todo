import { BOARD_PALETTE, MAX_BOARDS } from '../constants'
import Modal from './Modal'
import BudgetTab from './BudgetTab'
import { useEffect, useState } from 'react'

// Edit/create dialog for a board (name, multiline description, color).
// In edit mode an extra «Бюджет» tab shows the board's financial summary.
export default function BoardForm({ open, board, boardsCount, tasks = [], onClose, onSubmit, onDelete }) {
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
      setError('Укажите название доски')
      return
    }
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || null,
        color,
      })
    } catch (err) {
      setError(err?.response?.data?.detail || 'Ошибка сохранения доски')
    }
  }

  const remove = async () => {
    if (!window.confirm(`Удалить доску «${board.name}»? Все её задачи, списки и теги будут удалены безвозвратно.`)) return
    try {
      await onDelete(board)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Ошибка удаления доски')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Редактировать доску' : 'Новая доска'}>
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
            Общие
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
            Бюджет
          </button>
        </div>
      )}

      {tab === 'budget' ? (
        <BudgetTab board={board} tasks={tasks} />
      ) : (
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Название</label>
          <input
            type="text"
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            className="w-full p-2 border rounded"
            placeholder="Например: Работа"
            required
            autoFocus
          />
          <p className="text-[10px] text-gray-500 mt-1">До 20 символов.</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Описание</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full p-2 border rounded"
            rows={3}
            placeholder="Необязательно"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Цвет доски</label>
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
        {!isEdit && boardsCount >= MAX_BOARDS && (
          <p className="text-sm text-red-500">Достигнут лимит: максимум {MAX_BOARDS} досок.</p>
        )}
        <div className="flex items-center gap-2 pt-2">
          {isEdit && (
            <button
              type="button"
              onClick={remove}
              className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 mr-auto"
            >
              Удалить
            </button>
          )}
          <button type="button" onClick={onClose} className="px-4 py-2 text-gray-500 hover:text-gray-700">
            Отмена
          </button>
          <button
            type="submit"
            disabled={!isEdit && boardsCount >= MAX_BOARDS}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
          >
            Сохранить
          </button>
        </div>
      </form>
      )}
    </Modal>
  )
}
