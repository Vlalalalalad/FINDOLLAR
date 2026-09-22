import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Flag, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import type { TaskPriority } from '../../types/planner'
import { PRIORITY_COLORS, PRIORITY_LABELS, PRIORITY_OPTIONS } from '../../lib/plannerPriority'
import { PlannerSheet } from './PlannerSheet'
import { RecurrenceScopeMenu, type RecurrenceEditScope } from './CompactPlannerMenu'
import './priority-picker.css'

/** The same short choice list anchors to the flag on PC and becomes a small touch sheet. */
export function PriorityPicker({ value, onChange, disabled = false, label = 'Пріоритет', className, onOpen, rowSwipe = false, recurring = false }: {
  value: TaskPriority
  onChange: (priority: TaskPriority, scope?: RecurrenceEditScope) => void | Promise<void>
  recurring?: boolean
  disabled?: boolean
  label?: string
  className?: string
  onOpen?: () => void
  rowSwipe?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [scopeValue, setScopeValue] = useState<TaskPriority | null>(null)
  const [pending, setPending] = useState(false)
  const [optimisticValue, setOptimisticValue] = useState<TaskPriority | null>(null)
  const [error, setError] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const selectionRef = useRef<HTMLButtonElement>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const displayValue = optimisticValue ?? value
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (optimisticValue && value === optimisticValue) setOptimisticValue(null)
  }, [optimisticValue, value])

  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      const trigger = triggerRef.current
      const panel = contentRef.current?.closest<HTMLElement>('.planner-priority-sheet')
      if (!trigger || !panel) return
      const rect = trigger.getBoundingClientRect()
      const viewport = window.visualViewport
      const viewportLeft = viewport?.offsetLeft ?? 0
      const viewportTop = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth
      const height = viewport?.height ?? window.innerHeight
      const panelWidth = Math.min(224, width - 24)
      const panelHeight = panel.getBoundingClientRect().height
      const left = Math.max(viewportLeft + 12, Math.min(rect.right - panelWidth, viewportLeft + width - panelWidth - 12))
      const below = rect.bottom + 8
      const top = Math.max(viewportTop + 12, below + panelHeight <= viewportTop + height - 12 ? below : rect.top - panelHeight - 8)
      panel.style.setProperty('--priority-popover-left', `${left}px`)
      panel.style.setProperty('--priority-popover-top', `${top}px`)
    }
    position()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position)
    if (contentRef.current) observer?.observe(contentRef.current)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', position)
    }
  }, [open])

  const choose = async (priority: TaskPriority, scope?: RecurrenceEditScope) => {
    if (inFlight.current || disabled) return
    if (priority === displayValue) { setOpen(false); return }
    if (recurring && !scope) { setOpen(false); setScopeValue(priority); return }
    setScopeValue(null)
    inFlight.current = true
    setPending(true)
    setError(null)
    setOptimisticValue(priority)
    setOpen(false)
    try {
      await onChange(priority, scope)
    } catch (reason) {
      if (mounted.current) {
        setOptimisticValue(null)
        setError(reason instanceof Error ? reason.message : 'Не вдалося змінити пріоритет плану. Спробуйте ще раз.')
        setOpen(true)
      }
    } finally {
      inFlight.current = false
      if (mounted.current) setPending(false)
    }
  }

  return <>
    <RecurrenceScopeMenu open={scopeValue !== null} anchor={triggerRef} onClose={() => setScopeValue(null)} onChoose={scope => { if (scopeValue) void choose(scopeValue, scope) }} />
    <button ref={triggerRef} type="button" data-no-swipe data-row-swipe-control={rowSwipe || undefined} data-active={displayValue !== 'none' || undefined} className={clsx('planner-priority-trigger', className)}
      style={{ color: PRIORITY_COLORS[displayValue] }} disabled={disabled || pending}
      aria-label={`${label}: ${PRIORITY_LABELS[displayValue]}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={event => {
        event.stopPropagation()
        onOpen?.()
        setError(null)
        setOpen(true)
      }}>
      <Flag size={17} aria-hidden="true" />
    </button>
    <PlannerSheet open={open} title="Пріоритет" className="planner-priority-sheet" contentRef={contentRef} initialFocusRef={selectionRef} onClose={() => { if (!inFlight.current) setOpen(false) }}>
      <div className="planner-priority-options" data-no-swipe role="group" aria-label="Пріоритет плану" aria-busy={pending || undefined} onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        if (!buttons.length) return
        event.preventDefault()
        event.stopPropagation()
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next].focus({ preventScroll: true })
      }}>
          {PRIORITY_OPTIONS.map(priority => <button key={priority} ref={priority === displayValue ? selectionRef : undefined} type="button" data-no-swipe
          aria-pressed={priority === displayValue} disabled={pending || disabled} onClick={event => { event.stopPropagation(); void choose(priority) }}>
          <Flag size={17} style={{ color: PRIORITY_COLORS[priority] }} aria-hidden="true" />
          <span>{PRIORITY_LABELS[priority]}</span>
          {priority === value && <Check size={16} aria-hidden="true" />}
        </button>)}
      </div>
      {pending && <p className="planner-priority-status" role="status"><Loader2 size={13} aria-hidden="true" />Зберігаємо…</p>}
      {error && <p className="planner-priority-error" role="alert">{error}</p>}
    </PlannerSheet>
  </>
}
