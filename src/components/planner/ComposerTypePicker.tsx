import { useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { PlannerSheet } from './PlannerSheet'

export type ComposerEntryType = 'plan' | 'note' | 'goal'
const labels = { plan: 'План', note: 'Нотатка', goal: 'Ціль' }

/** Anchored on touch screens too; only the three record types belong here. */
export function ComposerTypePicker({ value, onChange, disabled, records = true }: {
  value: ComposerEntryType; onChange: (value: ComposerEntryType) => void; disabled?: boolean; records?: boolean
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      const panel = contentRef.current?.closest<HTMLElement>('.planner-type-popover')
      const trigger = triggerRef.current
      if (!panel || !trigger) return
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
      const rect = trigger.getBoundingClientRect(), panelHeight = panel.getBoundingClientRect().height
      const panelWidth = Math.min(176, width - 24)
      panel.style.width = `${panelWidth}px`
      panel.style.left = `${Math.max(left + 12, Math.min(rect.left, left + width - panelWidth - 12))}px`
      panel.style.top = `${Math.max(top + 8, Math.min(rect.top - panelHeight - 5 >= top + 8 ? rect.top - panelHeight - 5 : rect.bottom + 5, top + height - panelHeight - 8))}px`
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
  return <>
    <button type="button" ref={triggerRef} className="planner-parameter" aria-label={`Тип запису: ${labels[value]}`} aria-expanded={open} aria-haspopup="dialog" disabled={disabled} onPointerDown={event => event.preventDefault()} onClick={() => setOpen(true)}>{labels[value]}<ChevronDown size={14} /></button>
    <PlannerSheet open={open} preserveTextFocus onClose={() => setOpen(false)} title="Тип запису" className="planner-type-popover" contentRef={contentRef} initialFocusRef={selectedRef}>
      <div className="planner-choice-list" onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next]?.focus({ preventScroll: true })
      }}>
        {(['plan', ...(records ? ['note', 'goal'] : [])] as ComposerEntryType[]).map(type => <button key={type} ref={type === value ? selectedRef : undefined} type="button" aria-pressed={value === type} onClick={() => { onChange(type); setOpen(false) }}>{labels[type]}{value === type && <Check size={15} />}</button>)}
      </div>
    </PlannerSheet>
  </>
}
