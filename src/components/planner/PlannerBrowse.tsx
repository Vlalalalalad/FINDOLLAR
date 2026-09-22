import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { Button, Input } from '../ui'
import { usePlanner } from '../../context/PlannerContext'
import { usePlannerWorkspaceState } from '../../hooks/usePlannerWorkspace'
import { addDays, countPlannerTasks, expandTasks, isOverdue, localDateKey, occursOnDate, parseLocalDate, selectPlannerHistory, sortOccurrences } from '../../lib/planner'
import type { TaskOccurrence, TaskPriority } from '../../types/planner'
import { PlanList } from './PlanList'
import { ChoicePicker } from './PlannerPickers'

type Filter = 'all' | 'today' | 'overdue' | 'upcoming' | 'completed' | 'high' | 'recurring' | 'undated' | 'reminders'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Всі' },
  { value: 'today', label: 'Сьогодні' },
  { value: 'overdue', label: 'Прострочені' },
  { value: 'upcoming', label: 'Майбутні' },
  { value: 'completed', label: 'Виконані' },
  { value: 'high', label: 'Високий пріоритет' },
  { value: 'recurring', label: 'Повторювані' },
  { value: 'undated', label: 'Без дати' },
  { value: 'reminders', label: 'З нагадуваннями' },
]

const EMPTY_MESSAGES: Record<Filter, string> = {
  all: 'Поки немає планів. Почніть із невеликого плану.',
  today: 'На сьогодні все вільно.',
  overdue: 'Прострочених планів немає.',
  upcoming: 'Майбутніх планів поки немає.',
  completed: 'Тут з’являться виконані плани.',
  high: 'Планів із високим пріоритетом немає.',
  recurring: 'Повторюваних планів поки немає.',
  undated: 'Немає планів без дати.',
  reminders: 'Планів із нагадуваннями поки немає.',
}

type TaskGroup = { key: string; date: string | null; completed: boolean; items: TaskOccurrence[] }

/** Secondary search and history preserve the planner's bounded projections. */
export function PlannerBrowse({ now, onOpen, onToggle, onUndatedChange, onQuickActions, onDelete, onPriorityChange, renderEditor }: {
  now: Date
  onOpen: (task: TaskOccurrence) => void
  onToggle: (task: TaskOccurrence) => Promise<void>
  onUndatedChange: (undated: boolean) => void
  onQuickActions?: (task: TaskOccurrence) => void
  onDelete?: (task: TaskOccurrence) => void
  onPriorityChange?: (task: TaskOccurrence, priority: TaskPriority, scope?: 'occurrence' | 'series') => Promise<void>
  renderEditor?: (task: TaskOccurrence) => ReactNode
}) {
  const { tasks, overrides, busy, loading } = usePlanner()
  const today = localDateKey(now)
  const [filter, setFilter] = usePlannerWorkspaceState<Filter>('browse:filter', 'all')
  const [query, setQuery] = usePlannerWorkspaceState('browse:query', '')
  const [futureDays, setFutureDays] = usePlannerWorkspaceState('browse:future-days', 90)
  const [visibleCount, setVisibleCount] = usePlannerWorkspaceState('browse:visible-count', 60)
  const listEnd = addDays(today, futureDays)

  useEffect(() => {
    onUndatedChange(filter === 'undated')
    return () => onUndatedChange(false)
  }, [filter, onUndatedChange])

  const occurrences = useMemo(() => {
    // One-off plans remain visible regardless of age; only virtual repetitions use a window.
    const oneOff = expandTasks(tasks.filter(task => !task.recurrence), overrides, '0001-01-01', '9999-12-31')
    const recurring = expandTasks(tasks.filter(task => task.recurrence), overrides, today, listEnd)
    return [...oneOff, ...recurring]
  }, [tasks, overrides, today, listEnd])
  const counts = useMemo(() => countPlannerTasks(tasks, overrides, now, listEnd), [tasks, overrides, now, listEnd])
  const matchSearch = useCallback((task: TaskOccurrence) =>
    `${task.title} ${task.description ?? ''} ${(task.tags ?? []).join(' ')}`.toLocaleLowerCase('uk-UA').includes(query.trim().toLocaleLowerCase('uk-UA')),
  [query])
  const matchFilter = useCallback((task: TaskOccurrence) => {
    switch (filter) {
      case 'today': return occursOnDate(task, today)
      case 'overdue': return isOverdue(task, now)
      case 'upcoming': return !!task.date && task.date > today && task.status !== 'completed'
      case 'completed': return task.status === 'completed'
      case 'high': return task.priority === 'high'
      case 'recurring': return task.isRecurring
      case 'undated': return !task.date
      case 'reminders': return task.reminders.length > 0
      default: return true
    }
  }, [filter, today, now])

  const result = useMemo(() => {
    const historyOptions = {
      now, query, limit: visibleCount,
      ...(filter === 'high' ? { priority: 'high' as const } : {}),
      remindersOnly: filter === 'reminders', recurringOnly: filter === 'recurring',
    }
    const globalFilter = ['all', 'high', 'recurring', 'reminders', 'overdue', 'completed'].includes(filter)
    const includeOverdue = globalFilter && filter !== 'completed'
    const includeCompleted = globalFilter && filter !== 'overdue'
    const overdue = includeOverdue ? selectPlannerHistory(tasks, overrides, { ...historyOptions, kind: 'overdue' }) : { items: [], total: 0 }
    const completed = includeCompleted ? selectPlannerHistory(tasks, overrides, { ...historyOptions, kind: 'completed' }) : { items: [], total: 0 }
    const current = occurrences.filter(task => matchSearch(task) && matchFilter(task)
      && !(includeOverdue && isOverdue(task, now))
      && !(includeCompleted && task.status === 'completed'))
    return {
      items: sortOccurrences([...overdue.items, ...current, ...completed.items], now),
      total: overdue.total + current.length + completed.total,
    }
  }, [tasks, overrides, occurrences, query, filter, visibleCount, matchSearch, matchFilter, now])

  const groups = useMemo(() => {
    const grouped = new Map<string, TaskGroup>()
    for (const task of result.items.slice(0, visibleCount)) {
      const completed = task.status === 'completed'
      const key = `${completed ? 'completed' : 'planned'}:${task.date ?? 'undated'}`
      const group = grouped.get(key)
      if (group) group.items.push(task)
      else grouped.set(key, { key, date: task.date, completed, items: [task] })
    }
    return [...grouped.values()].sort((a, b) => Number(a.completed) - Number(b.completed)
      || (a.date ?? '9999-12-31').localeCompare(b.date ?? '9999-12-31'))
  }, [result.items, visibleCount])

  const canExtendFuture = ['all', 'upcoming', 'high', 'recurring', 'reminders'].includes(filter)
    && tasks.some(task => task.recurrence)
  const groupTitle = (group: TaskGroup) => {
    const date = group.date
      ? parseLocalDate(group.date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', ...(group.date.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' as const } : {}) })
      : 'Без дати'
    return `${group.date === today ? 'Сьогодні · ' : ''}${date}${group.completed ? ' · Виконані' : group.items.every(task => isOverdue(task, now)) ? ' · Прострочені' : ''}`
  }

  return <div className="planner-browse flex min-w-0 flex-col gap-4">
    <div className="relative min-w-0">
      <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 text-text-muted" />
      <Input aria-label="Пошук планів" placeholder="Назва, опис або мітка" value={query}
        onChange={event => { setQuery(event.target.value); setVisibleCount(60) }} className="min-h-11 pl-10 pr-12" />
      {query && <button type="button" aria-label="Очистити пошук" className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-lg text-text-muted"
        onClick={() => { setQuery(''); setVisibleCount(60) }}><X size={16} aria-hidden="true" /></button>}
    </div>
    <ChoicePicker label="Фільтр планів" value={filter} onChange={value => { setFilter(value); setVisibleCount(60) }}
      options={FILTERS.map(item => {
        const count = item.value === 'today' || item.value === 'overdue' || item.value === 'completed' || item.value === 'upcoming'
          ? counts[item.value] : null
        return { value: item.value, label: item.label + (count !== null ? ` (${loading ? '…' : count})` : '') }
      })} />
    <div aria-busy={loading}>
      {loading ? <div role="status" className="planner-day-empty">Завантажую плани…</div>
        : groups.length ? <div className="flex flex-col gap-5">
          {groups.map(group => <section key={group.key}>
            <h2 className="mb-2 text-xs font-semibold text-text-muted">{groupTitle(group)}</h2>
            <PlanList tasks={group.items} now={now} busy={busy} onOpen={onOpen} onToggle={onToggle} onQuickActions={onQuickActions} onDelete={onDelete} onPriorityChange={onPriorityChange} renderEditor={renderEditor} />
          </section>)}
        </div> : <div className="planner-day-empty"><p>{query.trim() ? 'Пошук нічого не знайшов. Спробуйте інші слова.' : EMPTY_MESSAGES[filter]}</p></div>}
      {!loading && result.total > visibleCount && <Button variant="ghost" className="mt-3 min-h-11 w-full" onClick={() => setVisibleCount(count => count + 60)}>Показати ще ({result.total - visibleCount})</Button>}
      {!loading && canExtendFuture && <div className="mt-5 text-xs text-text-muted">
        <p>Майбутні повторення — до {parseLocalDate(listEnd).toLocaleDateString('uk-UA')}. Історія — за весь час.</p>
        <Button variant="ghost" className="mt-1 min-h-11 px-0 text-xs" onClick={() => setFutureDays(days => days + 90)}>Наступні 90 днів</Button>
      </div>}
    </div>
  </div>
}
