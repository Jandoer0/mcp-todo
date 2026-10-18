import { useState } from 'react'
import { currenciesApi } from '../api/client'

// «Параметры валют»: список валют пользователя + создание новой валюты
// (код, название, символ) с курсом к базовой единице (USD).
export default function CurrencyManager({ currencies = [], onChanged }) {
  const [form, setForm] = useState({ code: '', name: '', symbol: '', rate: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Редактирование курса прямо в строке списка
  const [editingId, setEditingId] = useState(null)
  const [editRate, setEditRate] = useState('')

  const create = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.code.trim() || !form.name.trim()) {
      setError('Укажите код и название валюты')
      return
    }
    setBusy(true)
    try {
      await currenciesApi.create({
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        symbol: form.symbol.trim(),
        rate: form.rate === '' ? null : Number(form.rate.replace(',', '.')),
      })
      setForm({ code: '', name: '', symbol: '', rate: '' })
      onChanged?.()
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось создать валюту')
    } finally {
      setBusy(false)
    }
  }

  const saveRate = async (id) => {
    const rate = Number(String(editRate).replace(',', '.'))
    if (!rate || rate <= 0) {
      setError('Курс должен быть числом больше нуля')
      return
    }
    setError('')
    try {
      await currenciesApi.update(id, { rate })
      setEditingId(null)
      onChanged?.()
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось сохранить курс')
    }
  }

  const remove = async (c) => {
    if (!confirm(`Удалить валюту «${c.code}»? Задачи с ней перейдут в базовую валюту (USD).`)) return
    setError('')
    try {
      await currenciesApi.remove(c.id)
      onChanged?.()
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось удалить валюту')
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Курс — стоимость 1 единицы валюты в базовых единицах (USD). Пример: курс RUB = 0,011
        означает, что 10 000 ₽ ≈ 110 $. Если курс не указан, бюджет покажет предупреждение.
      </p>

      {/* Список валют */}
      <div className="rounded border border-slate-200 divide-y divide-slate-100 max-h-64 overflow-y-auto">
        {currencies.length === 0 && (
          <p className="px-3 py-2 text-sm text-slate-400">Валют пока нет.</p>
        )}
        {currencies.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <div className="min-w-0">
              <span className="font-semibold text-slate-700">{c.code}</span>
              <span className="text-slate-400 mx-1.5">{c.symbol}</span>
              <span className="text-slate-500 truncate">{c.name}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {editingId === c.id ? (
                <>
                  <input
                    autoFocus
                    type="text"
                    inputMode="decimal"
                    value={editRate}
                    onChange={(e) => setEditRate(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveRate(c.id)}
                    className="w-24 p-1 border rounded text-sm tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => saveRate(c.id)}
                    className="text-green-600 hover:bg-green-50 px-2 py-1 rounded text-xs font-medium"
                  >
                    Сохранить
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="text-slate-500 hover:bg-slate-100 px-2 py-1 rounded text-xs"
                  >
                    Отмена
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(c.id)
                      setEditRate(c.rate != null ? String(c.rate) : '')
                    }}
                    className={`tabular-nums underline decoration-dotted underline-offset-2 ${
                      c.rate ? 'text-slate-600 hover:text-blue-600' : 'text-red-500 font-semibold'
                    }`}
                    title="Изменить курс"
                  >
                    {c.rate != null && c.rate !== 0 ? `1 = ${c.rate} $` : 'курс не указан'}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(c)}
                    className="text-red-500 hover:bg-red-50 px-2 py-1 rounded text-xs"
                    title="Удалить валюту"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Новая валюта */}
      <form onSubmit={create} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Код</label>
          <input
            type="text"
            placeholder="GBP"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            className="w-full p-2 border rounded text-sm uppercase"
            maxLength={10}
          />
        </div>
        <div className="col-span-2">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Название</label>
          <input
            type="text"
            placeholder="Фунт (UK)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full p-2 border rounded text-sm"
            maxLength={100}
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Символ</label>
          <input
            type="text"
            placeholder="£"
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value })}
            className="w-full p-2 border rounded text-sm"
            maxLength={10}
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Курс (к $)</label>
          <input
            type="text"
            inputMode="decimal"
            placeholder="1.27"
            value={form.rate}
            onChange={(e) => setForm({ ...form, rate: e.target.value })}
            className="w-full p-2 border rounded text-sm"
          />
        </div>
        <div className="col-span-2 sm:col-span-5">
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
