import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { Card } from '../ui'
import { usePlanner } from '../../context/PlannerContext'
import { useOrganization } from '../../context/OrganizationContext'
import { usePlannerClock } from '../../hooks/usePlannerClock'
import { expandTasks, localDateKey, occursOnDate, sortOccurrences } from '../../lib/planner'
import { convertPlannerEntry, type PlannerConversionInput } from '../../lib/plannerConversion'
import { TaskRow } from './TaskRow'
import { TaskEditor } from './TaskEditor'
import type { TaskOccurrence, TaskPriority } from '../../types/planner'

export function TodayPlansWidget() {
  const { tasks, overrides, loading, error, busy, toggleOccurrence, saveOccurrence, updateTask, refresh, acceptConversion } = usePlanner()
  const organization = useOrganization()
  const now = usePlannerClock()
  const today = localDateKey(now)
  const [selected, setSelected] = useState<TaskOccurrence | null>(null)
  const [open, setOpen] = useState(false)
  const [actionError, setActionError] = useState('')
  const plans = useMemo(() => sortOccurrences(expandTasks(tasks, overrides, today, today).filter(task => occursOnDate(task, today)), now), [tasks, overrides, today, now])
  const toggle = async (task: TaskOccurrence) => {
    setActionError('')
    try { await toggleOccurrence(task) } catch (err) { setActionError(err instanceof Error ? err.message : 'Не вдалося змінити статус.') }
  }
  const priority = async (task: TaskOccurrence, value: TaskPriority, scope?: 'occurrence' | 'series') => {
    if (task.isRecurring && scope !== 'series') await saveOccurrence(task, { priority: value })
    else await updateTask(task.taskId, { priority: value }, task.isRecurring ? tasks.find(item => item.id === task.taskId)?.updated_at : task.updated_at)
  }
  const convert = async (input: PlannerConversionInput) => {
    const result = await convertPlannerEntry(input)
    acceptConversion(result)
    organization.acceptConversion(result)
    await Promise.all([refresh(), organization.refresh()])
  }
  return <Card className="min-h-40">
    <div className="mb-3 flex items-center gap-2"><CalendarDays size={17} className="text-primary" /><h2 className="font-display font-semibold text-text">Сьогодні</h2><span className="ml-auto text-xs text-text-muted">{loading || error ? '—' : `${plans.filter(task => task.status !== 'completed').length} заплановано`}</span></div>
    {loading ? <p className="py-3 text-sm text-text-muted">Завантажую плани…</p> : plans.length ? <div className="flex flex-col gap-2">{plans.slice(0, 3).map(task => <TaskRow key={task.id} task={task} now={now} busy={busy} compact onOpen={value => { setSelected(value); setOpen(true) }} onToggle={toggle} onPriorityChange={priority} />)}</div> : error ? <p className="py-2 text-sm text-text-muted">Плани тимчасово недоступні.</p> : <p className="py-3 text-sm text-text-muted">На сьогодні планів немає. Можна спланувати щось нове.</p>}
    <TaskEditor open={open} occurrence={selected} onClose={() => setOpen(false)} onConvert={convert} availableTags={organization.entries.flatMap(entry => entry.tags)} />
    {actionError && <p role="alert" className="mt-2 text-xs text-danger">{actionError}</p>}
    <Link to="/plans?view=today" className="mt-2 inline-flex min-h-11 items-center text-xs font-semibold text-primary">Переглянути всі →</Link>
  </Card>
}
