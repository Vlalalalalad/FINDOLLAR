import { memo, useCallback, useRef, type CSSProperties } from 'react'
import { Bell, Check, Flag, MoreHorizontal, Repeat2, Text, Trash2, Undo2 } from 'lucide-react'
import clsx from 'clsx'
import type { TaskOccurrence, TaskPriority } from '../../types/planner'
import { isOverdue, parseLocalDate } from '../../lib/planner'
import { useTaskSwipe } from '../../hooks/useTaskSwipe'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../lib/plannerPriority'
import { PriorityPicker } from './PriorityPicker'
import './planner-gestures.css'

export const TaskRow = memo(function TaskRow({ task, now, busy, onOpen, onToggle, onQuickActions, onDelete, onPriorityChange, compact = false, timeline = false }: {
  task: TaskOccurrence
  now: Date
  busy?: boolean
  onOpen: (task: TaskOccurrence) => void
  onToggle: (task: TaskOccurrence) => void | Promise<void>
  onQuickActions?: (task: TaskOccurrence) => void
  onDelete?: (task: TaskOccurrence) => void
  onPriorityChange?: (task: TaskOccurrence, priority: TaskPriority, scope?: 'occurrence' | 'series') => Promise<void>
  compact?: boolean
  timeline?: boolean
}) {
  const completed = task.status === 'completed'
  const overdue = isOverdue(task, now)
  const hasDescription = !!task.description?.trim()
  const togglePending = useRef(false)
  const toggle = useCallback(async () => {
    if (busy || togglePending.current) return
    togglePending.current = true
    try { await onToggle(task) } finally { togglePending.current = false }
  }, [busy, onToggle, task])
  const swipe = useTaskSwipe({
    enabled: timeline && !busy, resetKey: `${task.id}:${task.status}`, hasLeftActions: !!onQuickActions,
    onToggle: toggle, onQuickActions: () => onQuickActions?.(task),
  })
  const quickActions = () => { swipe.closeActions(); onQuickActions?.(task) }
  const remove = () => { swipe.closeActions(); onDelete?.(task) }
  const priority = onPriorityChange
    ? <PriorityPicker value={task.priority} recurring={task.isRecurring} onChange={(value, scope) => onPriorityChange(task, value, scope)} disabled={busy} rowSwipe
      className="planner-row-priority" label={`Пріоритет плану «${task.title}»`} onOpen={swipe.closeActions} />
    : <span className="planner-row-priority planner-priority-static" style={{ color: PRIORITY_COLORS[task.priority] }}
      aria-label={PRIORITY_LABELS[task.priority]}><Flag size={17} aria-hidden="true" /></span>
  if (timeline) {
    const startTime = task.time?.slice(0, 5)
    const startMinutes = startTime ? Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5)) : 0
    const endMinutes = startMinutes + (task.duration_minutes ?? 0)
    const endTime = startTime && task.duration_minutes
      ? `${String(Math.floor(endMinutes / 60) % 24).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}` : null
    const dayOffset = Math.floor(endMinutes / 1440)
    const endDayLabel = dayOffset === 1 ? ', наступного дня' : dayOffset > 1 ? `, через ${dayOffset} днів` : ''
    return (
      <div ref={swipe.ref} {...swipe.bind}
        className={clsx('planner-timeline-task planner-action-row', completed && 'is-completed', swipe.isRevealed && 'has-revealed-actions')}
        style={{ touchAction: 'pan-y pinch-zoom', '--planner-action-count': 1 + Number(!!onQuickActions) + Number(!!onDelete) } as CSSProperties} aria-busy={busy || undefined}
        onKeyDown={event => { if (event.key === 'Escape' && swipe.isRevealed) { event.preventDefault(); event.stopPropagation(); swipe.closeActions() } }}
        draggable={!busy}
        onDragStart={event => {
          if (!window.matchMedia('(pointer: fine)').matches) { event.preventDefault(); return }
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('application/x-findossar-task', task.id)
        }}>
        <div className="planner-swipe-action" aria-hidden="true">
          {completed ? <Undo2 size={21} /> : <Check size={21} />}
        </div>
        {onQuickActions && <>
          <div className="planner-swipe-left-actions" aria-hidden={!swipe.isRevealed}>
            {onDelete && <button type="button" data-no-swipe tabIndex={swipe.isRevealed ? 0 : -1} disabled={busy} onClick={remove} className="planner-swipe-delete" aria-label={`Видалити: ${task.title}`}><Trash2 size={18} /><span>Видалити</span></button>}
            <button type="button" data-no-swipe tabIndex={swipe.isRevealed ? 0 : -1} disabled={busy} onClick={quickActions} className="planner-swipe-quick" aria-label={`Швидкі дії: ${task.title}`}><MoreHorizontal size={21} /><span>Швидкі дії</span></button>
          </div>
          <div className="planner-swipe-quick-feedback" aria-hidden="true"><MoreHorizontal size={22} /><span>Швидкі дії</span></div>
        </>}
        <div className="planner-timeline-surface">
          <button type="button" draggable={!busy} className="planner-timeline-open" onClick={() => onOpen(task)}
            aria-label={`План ${task.title}, ${task.date ? `${parseLocalDate(task.date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}${task.end_date ? ` — ${parseLocalDate(task.end_date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}` : ''}, ` : 'без дати, '}${startTime ?? '--:--'}${endTime ? ` — ${endTime}${endDayLabel}` : ''}, ${PRIORITY_LABELS[task.priority].toLowerCase()}${hasDescription ? ', є опис' : ''}${completed ? ', виконано' : ''}`}>
            <span className={clsx('planner-timeline-time', !startTime && 'is-unscheduled')} aria-hidden="true">
              <span>{startTime ?? '--:--'}</span>
              {endTime && <span className="planner-timeline-end">– {endTime}{dayOffset > 0 && <sup>+{dayOffset}</sup>}</span>}
            </span>
            <span className="planner-timeline-marker" style={{ backgroundColor: task.color }} aria-hidden="true" />
            <span className="planner-timeline-title">{task.title}</span>
            {hasDescription && <span className="planner-row-indicators"><Text size={14} aria-label="Є опис плану" /></span>}
          </button>
          {priority}
          <div className="planner-row-controls">
          <button type="button" role="checkbox" aria-checked={completed} data-no-swipe data-row-swipe-control
            aria-label={`${completed ? 'Повернути в заплановані' : 'Виконати'}: ${task.title}`}
            disabled={busy} onClick={toggle} className="planner-timeline-toggle">
            <span className={clsx('planner-timeline-check', completed && 'is-checked')}>
              {completed && <Check size={14} />}
            </span>
          </button>
          {onQuickActions && <button type="button" data-no-swipe data-row-swipe-control disabled={busy} className="planner-row-control" aria-label={`Швидкі дії: ${task.title}`} onClick={quickActions}><MoreHorizontal size={19} /></button>}
          {onDelete && <button type="button" data-no-swipe data-row-swipe-control disabled={busy} className="planner-row-control planner-row-delete" aria-label={`Видалити: ${task.title}`} onClick={remove}><Trash2 size={17} /></button>}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className={clsx('planner-task planner-compact-row flex min-w-0 items-center gap-1 rounded-xl border border-border bg-surface px-2 transition-opacity duration-200', completed && 'opacity-60')}>
      <button type="button" onClick={() => onOpen(task)} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-3 pr-2 text-left focus-visible:outline-primary">
        <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: task.color }} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2"><span className={clsx('truncate text-sm font-semibold text-text', completed && 'line-through')}>{task.title}</span>{hasDescription && <Text size={14} className="shrink-0 text-text-muted" aria-label="Є опис плану" />}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
            <span className={overdue ? 'text-danger' : ''}>
              {!compact && (task.date ? parseLocalDate(task.date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' }) : 'Без дати')}
              {!compact && ' · '}<span className={!task.time ? 'planner-time-placeholder' : undefined}>{task.time?.slice(0, 5) ?? '--:--'}</span>
              {overdue && ' · Прострочений'}
            </span>
            {task.duration_minutes && !compact && <span>{task.duration_minutes} хв</span>}
            {task.isRecurring && <Repeat2 size={13} aria-label="Повторюваний план" />}
            {task.reminders.length > 0 && <Bell size={13} aria-label="З нагадуванням" />}
          </span>
        </span>
      </button>
      {priority}
      <button type="button" role="checkbox" aria-checked={completed} aria-label={`${completed ? 'Повернути в заплановані' : 'Виконати'}: ${task.title}`}
        disabled={busy} onClick={toggle} className="planner-compact-toggle flex h-11 w-11 shrink-0 items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40">
        <span className={clsx('flex h-5 w-5 items-center justify-center rounded-md border', completed ? 'border-primary bg-primary text-white' : 'border-text-muted/50')}>
          {completed && <Check size={14} />}
        </span>
      </button>
    </div>
  )
})
