import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { PlannerSheet } from './PlannerSheet'

/** Reuses planner focus/Back handling with a small viewport-bound anchored panel. */
export function CompactPlannerMenu({ open, onClose, anchor, title, children }: {
  open: boolean; onClose: () => void; anchor: RefObject<HTMLElement>; title: string; children: ReactNode
}) {
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      const panel = content.current?.closest<HTMLElement>('.planner-type-popover')
      if (!panel || !anchor.current) return
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
      const rect = anchor.current.getBoundingClientRect()
      const panelWidth = Math.min(240, width - 24)
      panel.style.width = `${panelWidth}px`
      panel.style.maxHeight = `${Math.max(44, height - 24)}px`
      const panelHeight = panel.getBoundingClientRect().height
      panel.style.left = `${Math.max(left + 12, Math.min(rect.right - panelWidth, left + width - panelWidth - 12))}px`
      panel.style.top = `${Math.max(top + 12, Math.min(rect.bottom + 6 + panelHeight <= top + height - 12 ? rect.bottom + 6 : rect.top - panelHeight - 6, top + height - panelHeight - 12))}px`
    }
    position()
    const observer = new ResizeObserver(position)
    if (content.current) observer.observe(content.current)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', position)
    }
  }, [open, anchor])
  return <PlannerSheet open={open} onClose={onClose} title={title} className="planner-type-popover" contentRef={content}>
    <div className="planner-choice-list">{children}</div>
  </PlannerSheet>
}

export type RecurrenceEditScope = 'occurrence' | 'series'
export function RecurrenceScopeMenu({ open, onClose, anchor, onChoose }: {
  open: boolean; onClose: () => void; anchor: RefObject<HTMLElement>; onChoose: (scope: RecurrenceEditScope) => void
}) {
  return <CompactPlannerMenu open={open} onClose={onClose} anchor={anchor} title="Застосувати зміни">
    <button type="button" onClick={() => onChoose('occurrence')}>Тільки цей день</button>
    <button type="button" onClick={() => onChoose('series')}>Усі повторення</button>
  </CompactPlannerMenu>
}
