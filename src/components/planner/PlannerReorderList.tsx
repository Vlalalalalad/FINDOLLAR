import { useCallback, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react'
import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

/** Ordinary scrolling/swiping wins; reordering begins only after a stationary hold. */
export function PlannerReorderList({ ids, onReorder, children, disabled = false, touchOnly = false, groupForId }: {
  ids: string[]; onReorder: (ids: string[]) => void | Promise<void>; children: ReactNode; disabled?: boolean; touchOnly?: boolean; groupForId?: (id: string) => string
}) {
  const [active, setActive] = useState(false)
  const mouse = useSensor(MouseSensor, { activationConstraint: { distance: 6 } })
  const touch = useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } })
  const keyboard = useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  const sensors = useSensors(...(touchOnly ? [touch, keyboard] : [mouse, touch, keyboard]))
  return <DndContext sensors={sensors} collisionDetection={closestCenter}
    modifiers={[({ transform }) => ({ ...transform, x: 0 })]}
    accessibility={{ screenReaderInstructions: { draggable: 'Щоб перемістити запис, натисніть пробіл. Стрілками виберіть місце. Натисніть пробіл для підтвердження або Escape для скасування.' }, announcements: {
      onDragStart: () => 'Переміщення запису.',
      onDragOver: ({ over }) => over ? `Позиція ${ids.indexOf(String(over.id)) + 1} з ${ids.length}.` : undefined,
      onDragEnd: () => 'Порядок змінено.', onDragCancel: () => 'Переміщення скасовано.',
    } }}
    onDragStart={() => {
      setActive(true)
      // A hold promoted to reorder must cancel any pending row-completion gesture.
      document.dispatchEvent(new CustomEvent('planner-row-gesture', { detail: null }))
    }}
    onDragCancel={() => setActive(false)}
    onDragEnd={({ active: item, over }) => {
      setActive(false)
      if (disabled || !over || item.id === over.id) return
      if (groupForId && groupForId(String(item.id)) !== groupForId(String(over.id))) return
      const from = ids.indexOf(String(item.id)), to = ids.indexOf(String(over.id))
      if (from >= 0 && to >= 0) void onReorder(arrayMove(ids, from, to))
    }}>
    <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
      <div className="planner-reorder-list" data-reordering={active || undefined}>{children}</div>
    </SortableContext>
  </DndContext>
}

/** Attach this adapter to the existing row/wrapper; no visible drag handle. */
export function usePlannerSortable(id: string, disabled = false) {
  const sortable = useSortable({ id, disabled, transition: { duration: 180, easing: 'ease' } })
  const listeners = Object.fromEntries(Object.entries(sortable.listeners ?? {}).map(([name, handler]) => [name, (event: SyntheticEvent) => {
    const target = event.target as Element
    // Text editing and explicit independent controls keep their own interactions.
    if (target.closest('input, textarea, select, [contenteditable="true"], [data-no-reorder]')) return
    handler(event)
  }]))
  const setNodeRef = useCallback((node: HTMLElement | null) => sortable.setNodeRef(node), [sortable.setNodeRef])
  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition,
    position: 'relative', zIndex: sortable.isDragging ? 2 : undefined,
  }
  return { setNodeRef, attributes: { ...sortable.attributes, role: 'group' }, listeners, style, isDragging: sortable.isDragging, isSorting: sortable.isSorting }
}
