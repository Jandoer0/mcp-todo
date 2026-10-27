import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listsApi } from '../api/client'
import Modal from './Modal'
import { PALETTE } from '../constants'

function Palette({ value, onPick }) {
  return (
    <div className="flex flex-wrap gap-1">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          className={`w-5 h-5 rounded-full border-2 ${
            value === c ? 'border-black' : 'border-transparent'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}

export default function ListsManager({ boardId, open, onClose, lists, onChanged }) {
  const { t } = useTranslation()
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PALETTE[0])
  const [editingColor, setEditingColor] = useState(null)

  // Системный список «Регулярные» не удаляется, не переименовывается, сохраняет
  // постоянный статус и всегда занимает позицию 0 (ТЗv2: циклические задачи
  // ⇔ Регулярные).
  const isRegular = (list) => list.kind === 'regular' || list.name === 'Регулярные'
  // Есть ли в доске системный «Регулярные»: блокирует перемещение других списков
  // на позицию 0.
  const hasRegular = lists.some(isRegular)

  if (!open) return null

  // Надёжная сортировка: отсутствующие позиции — в конец, при равенстве — по id.
  const sorted = [...lists].sort(
    (a, b) =>
      (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
      a.id - b.id,
  )

  const refresh = async (promise) => {
    try {
      await promise
      await onChanged()
    } catch (e) {
      alert(e?.response?.data?.detail || t('common.error'))
    }
  }

  const addList = () => {
    const name = newName.trim()
    if (!name) return
    if (lists.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      alert(t('lists.duplicateName'))
      return
    }
    refresh(listsApi.create(boardId, { name, color: newColor })).then(() => setNewName(''))
  }

  const rename = (list, name) => {
    const n = name.trim()
    if (!n || n === list.name) return
    if (lists.some((l) => l.name.toLowerCase() === n.toLowerCase() && l.id !== list.id)) {
      alert(t('lists.nameTaken'))
      return
    }
    refresh(listsApi.update(boardId, list.id, { name: n }))
  }

  const setColor = (list, color) => refresh(listsApi.update(boardId, list.id, { color }))

  const remove = (list) => {
    // Приёмник удаляемых задач: первый список со статусом todo (бэкенд ищет
    // приёмник по kind, имя может быть любым после локализации).
    const target =
      lists.find((l) => l.kind === 'todo' && l.id !== list.id)?.name ||
      lists.find((l) => l.kind !== 'regular' && l.id !== list.id)?.name ||
      list.name
    if (!confirm(t('lists.deleteConfirm', { name: list.name, target }))) return
    refresh(listsApi.remove(boardId, list.id))
  }

  const setKind = (list, kind) => refresh(listsApi.update(boardId, list.id, { kind }))

  const reorder = (list, dir) => {
    // Системный «Регулярные» — всегда первый (позиция 0): кнопка «Выше» для него
    // не имеет смысла, а «Ниже» не должна позволять другим спискам занять позицию 0.
    const idx = sorted.findIndex((l) => l.id === list.id)
    const target = dir === 'up' ? idx - 1 : idx + 1
    if (target < 0 || target >= sorted.length) return
    if (isRegular(list) && dir === 'down') return
    const order = [...sorted]
    ;[order[idx], order[target]] = [order[target], order[idx]]
    // Полная перенумерация позиций (1..n): устраняет дубликаты, из-за которых
    // свап равных position «залипал» и список не двигался.
    refresh(
      Promise.all(
        order.map((l, i) =>
          l.position === i + 1
            ? Promise.resolve()
            : listsApi.update(boardId, l.id, { position: i + 1 }),
        ),
      ),
    )
  }

  return (
    <Modal open={open} onClose={onClose} title={t('lists.title')}>

        <div className="mb-6 p-3 border rounded bg-gray-50">
          <div className="text-sm font-medium mb-2">{t('lists.newList')}</div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('lists.namePlaceholder')}
              className="flex-1 p-2 border rounded"
            />
            <button
              onClick={addList}
              className="bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700"
            >
              {t('common.add')}
            </button>
          </div>
          <Palette value={newColor} onPick={setNewColor} />
        </div>

        <div className="space-y-3">
          {sorted.map((list) => (
            <div key={list.id} className="border rounded p-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setEditingColor(editingColor === list.id ? null : list.id)}
                  className="w-5 h-5 rounded-full border border-gray-300"
                  style={{ backgroundColor: list.color }}
                  title={t('lists.colorTitle')}
                />
                <input
                  defaultValue={list.name}
                  readOnly={isRegular(list)}
                  onBlur={(e) => rename(list, e.target.value)}
                  className={`flex-1 p-1 border rounded bg-transparent ${isRegular(list) ? 'text-slate-500' : ''}`}
                  title={isRegular(list) ? t('lists.regularProtected') : undefined}
                />
                <button
                  onClick={() => reorder(list, 'up')}
                  disabled={isRegular(list) || sorted[0].id === list.id}
                  className="px-2 text-gray-500 disabled:opacity-30"
                  title={isRegular(list) ? t('lists.upRegularFixed') : t('lists.up')}
                >
                  ↑
                </button>
                <button
                  onClick={() => reorder(list, 'down')}
                  disabled={isRegular(list) || sorted[sorted.length - 1].id === list.id}
                  className="px-2 text-gray-500 disabled:opacity-30"
                  title={isRegular(list) ? t('lists.downRegularFixed') : t('lists.down')}
                >
                  ↓
                </button>
                <select
                  value={isRegular(list) ? 'regular' : list.kind || 'todo'}
                  disabled={isRegular(list)}
                  onChange={(e) => setKind(list, e.target.value)}
                  className="text-xs border rounded px-1 py-1 bg-white disabled:text-slate-500 disabled:bg-slate-50"
                  title={isRegular(list) ? t('lists.regularTitle') : t('lists.kindTitle')}
                >
                  {isRegular(list) && <option value="regular">{t('lists.kindRegular')}</option>}
                  <option value="todo">{t('lists.kindTodo')}</option>
                  <option value="progress">{t('lists.kindProgress')}</option>
                  <option value="done">{t('lists.kindDone')}</option>
                </select>
                <button
                  onClick={() => remove(list)}
                  disabled={isRegular(list)}
                  className="text-red-500 text-xs disabled:opacity-30"
                  title={isRegular(list) ? t('lists.deleteProtected') : t('lists.deleteTitle')}
                >
                  {t('common.delete')}
                </button>
              </div>
              {editingColor === list.id && (
                <div className="mt-2">
                  <Palette value={list.color} onPick={(c) => setColor(list, c)} />
                </div>
              )}
            </div>
          ))}
        </div>
    </Modal>
  )
}
