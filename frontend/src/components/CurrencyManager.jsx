import { useState } from 'react'
import { currenciesApi } from '../api/client'

const FIELDS = [
  { key: 'code', label: 'Код', placeholder: 'GBP', maxLength: 10, cls: 'uppercase' },
  { key: 'name', label: 'Название', placeholder: 'Фунт (UK)', maxLength: 100, cls: '' },
  { key: 'symbol', label: 'Символ', placeholder: '£', maxLength: 10, cls: '' },
  { key: 'rate', label: 'Курс (к $)', placeholder: '1.27', maxLength: 20, cls: 'tabular-nums' },
]

const EMPTY = { code: '', name: '', symbol: '', rate: '' }

// «Параметры валют»: карточки валют с полным редактированием (код, название,
// символ, курс к базовой единице USD) + добавление новой валюты.
export default function CurrencyManager({ currencies = [], onChanged }) {
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState('')
  // Редактирование карточки: id + черновик всех полей
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(EMPTY)
  const [editError, setEditError] = useState('')

  const parseRate = (v) => {
    if (v == null || String(v).trim() === '') return null
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : NaN // NaN = ошибка валидации
  }

  const create = async (e) => {
    e.preventDefault()
    setCreateError('')
    if (!form.code.trim() || !form.name.trim()) {
      setCreateError('Укажите код и название валюты')
      return
    }
    const rate = parseRate(form.rate)
    if (Number.isNaN(rate)) {
      setCreateError('Курс должен быть числом больше нуля (или пустым)')
      return
    }
    setBusy(true)
    try {
      await currenciesApi.create({
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        symbol: form.symbol.trim(),
        rate,
      })
      setForm(EMPTY)
      onChanged?.()
    } catch (err) {
      setCreateError(err?.response?.data?.detail || 'Не удалось создать валюту')
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (c) => {
    setEditingId(c.id)
    setEditError('')
    setDraft({
      code: c.code,
      name: c.name,
      symbol: c.symbol,
      rate: c.rate != null ? String(c.rate) : '',
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditError('')
  }

  const saveEdit = async (c) => {
    setEditError('')
    if (!draft.code.trim() || !draft.name.trim()) {
      setEditError('Укажите код и название валюты')
      return
    }
    const rate = parseRate(draft.rate)
    if (Number.isNaN(rate)) {
      setEditError('Курс должен быть числом больше нуля (или пустым)')
      return
    }
    try {
      await currenciesApi.update(c.id, {
        code: draft.code.trim().toUpperCase(),
        name: draft.name.trim(),
        symbol: draft.symbol.trim(),
        rate,
      })
      setEditingId(null)
      onChanged?.()
    } catch (err) {
      setEditError(err?.response?.data?.detail || 'Не удалось сохранить валюту')
    }
  }

  const remove = async (c) => {
    if (!confirm(`Удалить валюту «${c.code}»? Задачи с ней перейдут в дефолтную валюту.`)) return
    setEditError('')
    try {
      await currenciesApi.remove(c.id)
      if (editingId === c.id) cancelEdit()
      onChanged?.()
    } catch (err) {
      setEditError(err?.response?.data?.detail || 'Не удалось удалить валюту')
    }
  }

  // Перестановка валюты вверх/вниз: полный порядок сохраняется на бэкенде;
  // первая валюта списка становится валютой по умолчанию.
  const move = async (index, dir) => {
    const ids = currencies.map((c) => c.id)
    const target = index + dir
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    try {
      await currenciesApi.reorder(ids)
      onChanged?.()
    } catch (err) {
      setEditError(err?.response?.data?.detail || 'Не удалось изменить порядок')
    }
  }

  // Поля карточки: редактирование или просмотр
  const renderFields = (values, onChange, withLabels) => (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {FIELDS.map((f) => (
        <div key={f.key}>
          {withLabels && (
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
              {f.label}
            </label>
          )}
          <input
            type="text"
            inputMode={f.key === 'rate' ? 'decimal' : undefined}
            placeholder={f.placeholder}
            maxLength={f.maxLength}
            value={values[f.key]}
            onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && editingId && saveEdit(editingIdObj.current)}
            className={`w-full p-2 border rounded text-sm ${f.cls}`}
          />
        </div>
      ))}
    </div>
  )

  // ref для Enter в редактировании (id текущей карточки)
  const editingIdObj = { current: editingId }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Курс — стоимость 1 единицы валюты в базовых единицах (USD). Пример: курс RUB = 0,011
        означает, что 10 000 ₽ ≈ 110 $. Если курс не указан, бюджет покажет предупреждение.
      </p>

      {/* Карточки валют */}
      <div className="space-y-2 max-h-80 overflow-y-auto pr-0.5">
        {currencies.length === 0 && (
          <p className="text-sm text-slate-400">Валют пока нет — добавьте первую ниже.</p>
        )}
        {currencies.map((c, idx) =>
          editingId === c.id ? (
            /* Редактирование: все поля доступны */
            <div key={c.id} className="rounded-lg border border-blue-300 bg-blue-50/40 p-3 space-y-2">
              {renderFields(draft, setDraft, true)}
              {editError && <p className="text-sm text-red-500">{editError}</p>}
              <div className="flex justify-between items-center pt-1">
                <button
                  type="button"
                  onClick={() => remove(c)}
                  className="px-3 py-1.5 text-red-500 hover:bg-red-50 rounded font-medium text-sm transition-colors"
                >
                  Удалить
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="px-3 py-1.5 text-slate-500 hover:bg-slate-100 rounded text-sm"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={() => saveEdit(c)}
                    className="bg-green-600 text-white px-4 py-1.5 rounded hover:bg-green-700 font-medium text-sm"
                  >
                    Сохранить
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Просмотр: первая (дефолтная) валюта — в зелёной рамке-бирке */
            <div
              key={c.id}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 ${
                idx === 0 ? 'border-green-500 bg-green-50/40' : 'border-slate-200'
              }`}
            >
              {/* Порядок: вверх/вниз; первая валюта = по умолчанию */}
              <div className="flex flex-col shrink-0">
                <button
                  type="button"
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  className="text-slate-400 hover:text-blue-600 disabled:opacity-30 leading-none text-[10px] px-1"
                  title="Выше"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => move(idx, 1)}
                  disabled={idx === currencies.length - 1}
                  className="text-slate-400 hover:text-blue-600 disabled:opacity-30 leading-none text-[10px] px-1"
                  title="Ниже"
                >
                  ▼
                </button>
              </div>
              {/* Идентичность валюты: код · символ · название */}
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="shrink-0 font-bold text-slate-700 text-sm">{c.code}</span>
                <span className="w-5 shrink-0 text-center text-slate-400">{c.symbol}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{c.name}</span>
              </div>
              {/* Курс и кнопка редактирования */}
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`text-xs tabular-nums ${
                    c.rate ? 'text-slate-500' : 'text-red-500 font-semibold'
                  }`}
                  title={c.rate ? 'Курс к базовому USD' : 'Курс не указан'}
                >
                  {c.rate ? `1 = ${c.rate} $` : 'курс не указан'}
                </span>
                <button
                  type="button"
                  onClick={() => startEdit(c)}
                  className="px-2 py-1 rounded text-slate-500 hover:bg-slate-100 hover:text-blue-600 text-sm"
                  title="Редактировать валюту"
                >
                  ✎
                </button>
              </div>
            </div>
          ),
        )}
      </div>

      {/* Новая валюта */}
      <form onSubmit={create} className="rounded-lg border border-dashed border-slate-300 p-3 space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Новая валюта
        </div>
        {renderFields(form, setForm, true)}
        {createError && <p className="text-sm text-red-500">{createError}</p>}
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={busy}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50 font-medium text-sm"
          >
            Добавить валюту
          </button>
        </div>
      </form>
    </div>
  )
}
