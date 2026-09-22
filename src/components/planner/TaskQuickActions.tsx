import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Sun, Sunrise } from 'lucide-react'
import type { TaskOccurrence } from '../../types/planner'
import { addDays, localDateKey, parseLocalDate } from '../../lib/planner'
import { PlannerSheet } from './PlannerSheet'
import { DatePickerPanel } from './PlannerPickers'

export function TaskQuickActions({ task, onClose, onMove }: {
  task: TaskOccurrence | null
  onClose: () => void
  onMove: (task: TaskOccurrence, date: string) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dateOpen, setDateOpen] = useState(false)
  const [chosenDate, setChosenDate] = useState(task?.date ?? localDateKey())
  const pending = useRef(false)
  useEffect(() => { setError(''); setDateOpen(false); setChosenDate(task?.date ?? localDateKey()) }, [task?.id, task?.date])
  const move = async (date: string | null) => {
    if (!task || !date || pending.current) return
    pending.current = true
    setSaving(true); setError('')
    try { await onMove(task, date); onClose() }
    catch (err) { setError(err instanceof Error ? err.message : 'Не вдалося перенести план.') }
    finally { pending.current = false; setSaving(false) }
  }
  const today = localDateKey(new Date())
  const dateLabel = parseLocalDate(chosenDate).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', ...(chosenDate.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) }).replace(' р.', '')
  return <><PlannerSheet open={!!task} onClose={() => { if (!saving) { setError(''); onClose() } }} title="Швидкі дії">
    <p className="mb-3 truncate text-sm text-text-muted">{task?.title}</p>
    <div className="planner-quick-actions" aria-busy={saving}>
      <button type="button" disabled={saving} onClick={() => void move(today)}><Sun size={18} />Сьогодні</button>
      <button type="button" disabled={saving} onClick={() => void move(addDays(today, 1))}><Sunrise size={18} />Завтра</button>
      <button type="button" disabled={saving} aria-haspopup="dialog" aria-expanded={dateOpen} onClick={() => setDateOpen(true)}>
        <CalendarDays size={18} className="shrink-0" aria-hidden="true" /><span className="shrink-0">Інша дата</span><span className="text-xs text-text-muted">{dateLabel}</span>
      </button>
    </div>
    {task?.isRecurring && <p className="mt-3 text-xs text-text-muted">Перенесення змінює тільки це повторення.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
  </PlannerSheet>
    <PlannerSheet open={!!task && dateOpen} onClose={() => setDateOpen(false)} title="Перенести план">
      {dateOpen && <DatePickerPanel value={chosenDate} allowEmpty={false} onChange={date => {
        if (!date) return
        setChosenDate(date); setDateOpen(false); void move(date)
      }} />}
    </PlannerSheet>
  </>
}
