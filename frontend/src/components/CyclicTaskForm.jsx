import { useEffect, useState } from 'react'
import Modal from './Modal'
import TagInput from './TagInput'
import DateTimePicker from './DateTimePicker'
import { GravityEditor } from './editor/GravityEditor'
import { currenciesApi, tasksApi } from '../api/client'

function toDatetimeLocal(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export default function CyclicTaskForm({ open, task = null, lists = [], tags = [], onClose, onSubmit, onStop }) {
  const [form, setForm] = useState({ title: '', description: '', deadline: '', cycle_period: 'monthly', cycle_interval: 1, reminder_days: 0 })
  const [amountType, setAmountType] = useState('expense')
  const [amount, setAmount] = useState('')
  const [currencyId, setCurrencyId] = useState(null)
  const [currencies, setCurrencies] = useState([])
  const [selectedTags, setSelectedTags] = useState([])
  const [history, setHistory] = useState([])
  const [showAllHistory, setShowAllHistory] = useState(false)
  // Предпросмотр Markdown описания — как в обычной TaskForm: в редактировании
  // открываем сразу в предпросмотре, в создании — сразу в редакторе.
  // markdown-строка из редактора (WYSIWYG хранит HTML, наружу отдаём markdown)
  const [editorMarkdown, setEditorMarkdown] = useState('')
  const [descPreview, setDescPreview] = useState(false)

  useEffect(() => {
    currenciesApi.list().then((r) => setCurrencies(r.data || [])).catch(() => setCurrencies([]))
  }, [])

  useEffect(() => {
    if (!open) return
    if (task) {
      tasksApi.cycleHistory(task.id).then((r) => setHistory(r.data || [])).catch(() => setHistory([]))
      setShowAllHistory(false)
      setDescPreview(true)
      const value = Number(task.amount) || 0
      setForm({
        title: task.title || '', description: task.description || '', deadline: toDatetimeLocal(task.deadline),
        cycle_period: task.cycle_period || 'monthly', cycle_interval: task.cycle_interval || 1, reminder_days: task.reminder_days || 0,
      })
      setAmountType(value < 0 ? 'expense' : 'income')
      setAmount(value ? String(Math.abs(value)) : '')
      setCurrencyId(task.currency_id ?? null)
      setSelectedTags((task.tags || []).map((t) => typeof t === 'string' ? t : t.name))
    } else {
      setHistory([])
      setDescPreview(false)
      setForm({ title: '', description: '', deadline: '', cycle_period: 'monthly', cycle_interval: 1, reminder_days: 0 })
      setAmountType('expense'); setAmount(''); setCurrencyId(null); setSelectedTags([])
    }
    // Валюты НЕ в deps: догрузка списка не должна переинициализировать форму
    // и затирать начатый ввод (валюта по умолчанию — см. эффект ниже).
  }, [open, task])

  // Валюта по умолчанию — первая в пользовательском порядке; применяется,
  // пока пользователь не выбрал иначе (currencyId === null).
  useEffect(() => {
    if (!open || task || !currencies.length) return
    setCurrencyId((cur) => cur ?? currencies[0]?.id ?? null)
  }, [open, task, currencies])

  if (!open) return null
  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }))
  // Переключение чекбокса в предпросмотре правит markdown-источник локально;
  // изменения зафиксируются при нажатии «Сохранить задачу».
  const handleToggleCheckItem = (index, checked) => {
    const lines = String(form.description || '').split('\n')
    let seen = -1
    const newLines = lines.map((line) => {
      const m = line.match(/^(\s*[-*+]\s+)\[( |x|X)\](\s+.*)$/)
      if (!m) return line
      seen += 1
      if (seen !== index) return line
      return `${m[1]}[${checked ? 'x' : ' '}]${m[3]}`
    })
    if (seen < index) return // нет такого чекбокса в источнике
    setForm((f) => ({ ...f, description: newLines.join('\n') }))
  }
  const regularName = lists.find((l) => l.kind === 'regular' || l.name === 'Регулярные')?.name || 'Регулярные'
  const submit = (e) => {
    e.preventDefault()
    const n = Number.parseFloat(String(amount).replace(',', '.')) || 0
    onSubmit({
      title: form.title, description: editorMarkdown || null, deadline: form.deadline || null,
      list: regularName, tags: selectedTags, amount: n ? (amountType === 'income' ? n : -n) : 0,
      currency_id: n ? currencyId : null, is_cyclic: true, cycle_period: form.cycle_period,
      cycle_interval: Number(form.cycle_interval) || 1, reminder_days: Number(form.reminder_days) || 0,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title={task ? 'Изменить циклическую задачу' : 'Новая циклическая задача'}>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="field-label">Название</label>
          <input value={form.title} onChange={set('title')} required className="w-full p-2 border rounded" placeholder="Введите название задачи" />
        </div>
        <div>
          <label className="field-label">Следующий дедлайн</label>
          <DateTimePicker value={form.deadline} onChange={set('deadline')} placeholder="Не указан" />
        </div>
        <div>
          <label className="field-label">Период</label>
          <select value={form.cycle_period} onChange={set('cycle_period')} className="w-full p-2 border rounded">
            <option value="daily">Ежедневно</option><option value="weekly">Еженедельно</option><option value="monthly">Ежемесячно</option><option value="yearly">Ежегодно</option>
          </select>
        </div>
        <div><label className="field-label">Каждые N периодов</label><input type="number" min="1" max="365" value={form.cycle_interval} onChange={set('cycle_interval')} className="w-full p-2 border rounded" /></div>
        <div><label className="field-label">Показывать за (дней)</label><input type="number" min="0" max="365" value={form.reminder_days} onChange={set('reminder_days')} className="w-full p-2 border rounded" /></div>
        <div className="md:col-span-2">
          <label className="field-label">Сумма</label>
          <div className="flex gap-2">
            <div className="flex rounded overflow-hidden border"><button type="button" onClick={() => setAmountType('income')} className={`px-3 ${amountType === 'income' ? 'bg-blue-500 text-white' : ''}`}>Доход</button><button type="button" onClick={() => setAmountType('expense')} className={`px-3 ${amountType === 'expense' ? 'bg-red-500 text-white' : ''}`}>Расход</button></div>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))} placeholder="0" className="flex-1 min-w-0 p-2 border rounded" />
            <select value={currencyId ?? ''} onChange={(e) => setCurrencyId(e.target.value ? Number(e.target.value) : null)} className="p-2 border rounded">{currencies.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select>
          </div>
        </div>
        <div className="md:col-span-2">
          <label className="field-label">Описание</label>
          <GravityEditor
            initialValue={form.description || ''}
            onChange={(markdown) => setEditorMarkdown(markdown)}
          />
        </div>
        <div className="md:col-span-2"><label className="field-label">Теги</label><TagInput value={selectedTags} availableTags={tags} onChange={setSelectedTags} /></div>
        {task && (
          <div className="md:col-span-2 border-t border-slate-200 pt-3">
            <div className="flex items-center justify-between mb-2"><label className="field-label">Последние выполнения</label><button type="button" onClick={() => setShowAllHistory((v) => !v)} className="text-xs text-blue-600 hover:underline">{showAllHistory ? 'Свернуть' : 'Вся история'}</button></div>
            {history.length === 0 ? <p className="text-xs text-slate-400">Выполнений пока нет.</p> : (
              <div className="space-y-1 max-h-36 overflow-y-auto text-xs">
                {(showAllHistory ? history : history.slice(0, 3)).map((h) => (
                  <div key={h.id} className="flex justify-between gap-2 border-b border-slate-100 pb-1"><span className="truncate">{h.action === 'completed' ? '✓ Выполнена' : 'Остановлена'} · {h.actual_date ? new Date(h.actual_date).toLocaleDateString('ru-RU') : '—'}</span><span className="shrink-0 tabular-nums">{h.actual_amount != null ? `${h.actual_amount > 0 ? '+' : '−'}${Math.abs(Number(h.actual_amount)).toLocaleString('ru-RU')}` : '—'}</span></div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="md:col-span-2 flex justify-between items-center mt-2">
          {task ? <button type="button" onClick={() => onStop?.(task)} className="px-4 py-2 text-red-500 hover:bg-red-50 rounded">Сделать обычной</button> : <span />}
          <div className="flex gap-2"><button type="button" onClick={onClose} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded">Отмена</button><button type="submit" className="bg-green-600 text-white px-5 py-2 rounded hover:bg-green-700">{task ? 'Сохранить' : 'Создать задачу'}</button></div>
        </div>
      </form>
    </Modal>
  )
}
