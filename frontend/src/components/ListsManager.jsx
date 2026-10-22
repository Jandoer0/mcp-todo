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
            value === c ? 'border-black' : 'border-transparent'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}

export default function ListsManager({ boardId, open, onClose, lists, onChanged }) {
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PALETTE[0])
  const [editingColor, setEditingColor] = useState(null)

  // Системный список «Регулярные» не удаляется, не переименовывается и
  // сохраняет постоянный статус (ТЗv2: циклические задачи ⇔ Регулярные).
  const isRegular = (list) => list.kind === 'regular' || list.name === 'Регулярные'

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
    refresh(listsApi.create(boardId, { name, color: newColor })).then(() => setNewName(''))
  }

  const rename = (list, name) => {
    const n = name.trim()
    if (!n || n === list.name) return
    if (lists.some((l) => l.name.toLowerCase() === n.toLowerCase() && l.id !== list.id)) {
      alert('Имя списка занято')
      return
    }
    refresh(listsApi.update(boardId, list.id, { name: n }))
  }

  const setColor = (list, color) => refresh(listsApi.update(boardId, list.id, { color }))

  const remove = (list) => {
    if (!confirm(`Удалить список «${list.name}»? Задачи переместятся в «Не начато».`)) return
    refresh(listsApi.remove(boardId, list.id))
  }

  const setKind = (list, kind) => refresh(listsApi.update(boardId, list.id, { kind }))

  const reorder = (list, dir) => {
    const idx = sorted.findIndex((l) => l.id === list.id)
    const target = dir === 'up' ? idx - 1 : idx + 1
    if (target < 0 || target >= sorted.length) return
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
              className="bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700"
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
                  readOnly={isRegular(list)}
                  onBlur={(e) => rename(list, e.target.value)}
                  className={`flex-1 p-1 border rounded bg-transparent ${isRegular(list) ? 'text-slate-500' : ''}`}
                  title={isRegular(list) ? 'Системный список — переименование недоступно' : undefined}
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
                <select
                  value={isRegular(list) ? 'regular' : list.kind || 'todo'}
                  disabled={isRegular(list)}
                  onChange={(e) => setKind(list, e.target.value)}
                  className="text-xs border rounded px-1 py-1 bg-white disabled:text-slate-500 disabled:bg-slate-50"
                  title={isRegular(list) ? 'Системный список «Регулярные»' : 'Статус списка: задачи в списке со статусом «Завершено» считаются выполненными'}
                >
                  {isRegular(list) && <option value="regular">Регулярные</option>}
                  <option value="todo">К выполнению</option>
                  <option value="progress">В работе</option>
                  <option value="done">Завершено</option>
                </select>
                <button
                  onClick={() => remove(list)}
                  disabled={isRegular(list)}
                  className="text-red-500 text-xs disabled:opacity-30"
                  title={isRegular(list) ? 'Системный список удалить нельзя' : 'Удалить'}
                >
                  Удалить
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
