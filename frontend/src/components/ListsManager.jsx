import { useState } from 'react'
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
            value === c ? 'border-black dark:border-white' : 'border-transparent'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}

export default function ListsManager({ open, onClose, lists, onChanged }) {
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PALETTE[0])
  const [editingColor, setEditingColor] = useState(null)

  if (!open) return null

  const sorted = [...lists].sort((a, b) => a.position - b.position)

  const refresh = async (promise) => {
    try {
      await promise
      await onChanged()
    } catch (e) {
      alert(e?.response?.data?.detail || 'Ошибка')
    }
  }

  const addList = () => {
    const name = newName.trim()
    if (!name) return
    if (lists.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      alert('Список с таким именем уже есть')
      return
    }
    refresh(listsApi.create({ name, color: newColor })).then(() => setNewName(''))
  }

  const rename = (list, name) => {
    const n = name.trim()
    if (!n || n === list.name) return
    if (lists.some((l) => l.name.toLowerCase() === n.toLowerCase() && l.id !== list.id)) {
      alert('Имя списка занято')
      return
    }
    refresh(listsApi.update(list.id, { name: n }))
  }

  const setColor = (list, color) => refresh(listsApi.update(list.id, { color }))

  const remove = (list) => {
    if (list.is_default) return
    if (!confirm(`Удалить список «${list.name}»? Задачи переместятся в «Не начато».`)) return
    refresh(listsApi.remove(list.id))
  }

  const reorder = (list, dir) => {
    const idx = sorted.findIndex((l) => l.id === list.id)
    const target = dir === 'up' ? idx - 1 : idx + 1
    if (target < 0 || target >= sorted.length) return
    const other = sorted[target]
    refresh(
      Promise.all([
        listsApi.update(list.id, { position: other.position }),
        listsApi.update(other.id, { position: list.position }),
      ]),
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Управление списками">

        <div className="mb-6 p-3 border rounded bg-gray-50">
          <div className="text-sm font-medium mb-2">Новый список</div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Название (напр. Срочные)"
              className="flex-1 p-2 border rounded"
            />
            <button
              onClick={addList}
              className="bg-blue-500 text-white px-3 py-2 rounded hover:bg-blue-600"
            >
              Добавить
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
                  title="Цвет списка"
                />
                <input
                  defaultValue={list.name}
                  disabled={list.is_default}
                  onBlur={(e) => rename(list, e.target.value)}
                  className="flex-1 p-1 border rounded bg-transparent disabled:opacity-60"
                />
                <button
                  onClick={() => reorder(list, 'up')}
                  disabled={sorted[0].id === list.id}
                  className="px-2 text-gray-500 disabled:opacity-30"
                  title="Выше"
                >
                  ↑
                </button>
                <button
                  onClick={() => reorder(list, 'down')}
                  disabled={sorted[sorted.length - 1].id === list.id}
                  className="px-2 text-gray-500 disabled:opacity-30"
                  title="Ниже"
                >
                  ↓
                </button>
                <button
                  onClick={() => remove(list)}
                  disabled={list.is_default}
                  className="text-red-500 text-xs disabled:opacity-30"
                  title={list.is_default ? 'Зарезервированный список' : 'Удалить'}
                >
                  Удалить
                </button>
              </div>
              {list.is_default && (
                <div className="text-[11px] text-gray-500">
                  Зарезервированный список (нельзя удалить/переименовать)
                </div>
              )}
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
