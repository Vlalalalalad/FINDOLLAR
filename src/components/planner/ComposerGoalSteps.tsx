import { useId, useState } from 'react'
import { Check, Plus, Undo2, X } from 'lucide-react'
import { useTaskSwipe } from '../../hooks/useTaskSwipe'
import { PlannerReorderList, usePlannerSortable } from './PlannerReorderList'
import type { GoalData, GoalItem } from '../../types/organization'
import './organization-swipes.css'

function GoalStep({ item, onChange, onRemove, disabled }: {
  item: GoalItem; onChange: (item: GoalItem) => void; onRemove: () => void; disabled?: boolean
}) {
  const toggle = () => { if (!disabled) onChange({ ...item, completed: !item.completed }) }
  const swipe = useTaskSwipe({ enabled: !disabled, hasLeftActions: false, resetKey: `${item.id}:${item.completed}`, onToggle: toggle })
  return <div ref={swipe.ref} {...swipe.bind} data-goal-step-id={item.id} className={`composer-goal-step planner-timeline-task planner-action-row${item.completed ? ' is-completed' : ''}`}>
    <div className="planner-swipe-action" aria-hidden="true">{item.completed ? <Undo2 size={21} /> : <Check size={21} />}</div>
    <div className="planner-timeline-surface">
      <button type="button" role="checkbox" data-no-swipe data-no-reorder data-row-swipe-control aria-checked={item.completed} aria-label={`${item.completed ? 'Повернути крок' : 'Виконати крок'}: ${item.title}`} disabled={disabled} className="planner-timeline-toggle" onClick={toggle}><span className={`planner-timeline-check${item.completed ? ' is-checked' : ''}`}>{item.completed && <Check size={14} aria-hidden="true" />}</span></button>
      <input data-no-reorder className="composer-goal-step-title" aria-label="Назва кроку" value={item.title} maxLength={300} disabled={disabled} onChange={event => onChange({ ...item, title: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} />
      <button type="button" data-no-swipe data-no-reorder data-row-swipe-control className="planner-icon-button" aria-label={`Прибрати крок: ${item.title}`} disabled={disabled} onClick={onRemove}><X size={17} /></button>
    </div>
  </div>
}

function SortableGoalStep({ item, onChange, onRemove, disabled }: { item: GoalItem; onChange: (item: GoalItem) => void; onRemove: () => void; disabled?: boolean }) {
  const sortable = usePlannerSortable(item.id, disabled)
  return <div ref={sortable.setNodeRef} {...sortable.attributes} {...sortable.listeners} style={sortable.style} data-goal-step-sortable={item.id} className="composer-goal-step-sortable">
    <GoalStep item={item} onChange={onChange} onRemove={onRemove} disabled={disabled} />
  </div>
}

/** Inline in the shared composer for both new and existing goals. */
export function ComposerGoalSteps({ value, onChange, disabled }: {
  value: GoalData; onChange: (goal: GoalData) => void; disabled?: boolean
}) {
  const [newItem, setNewItem] = useState('')
  const id = useId()
  const addItem = () => {
    if (disabled || !newItem.trim() || value.items.length >= 200) return
    onChange({ ...value, items: [...value.items, { id: crypto.randomUUID(), title: newItem.trim(), completed: false }] })
    setNewItem('')
  }
  const reorder = (ids: string[]) => {
    const byId = new Map(value.items.map(item => [item.id, item]))
    const items = ids.map(id => byId.get(id)).filter((item): item is GoalItem => !!item)
    if (items.length === value.items.length) onChange({ ...value, items })
  }
  return <section className="composer-goal-steps" aria-labelledby={id}>
    <h3 id={id} className="composer-goal-steps-heading">Кроки до цілі</h3>
    <PlannerReorderList ids={value.items.map(item => item.id)} onReorder={reorder} disabled={disabled}>
      <div className="composer-goal-steps-list">{value.items.map(item => <SortableGoalStep key={item.id} item={item} disabled={disabled}
        onChange={next => onChange({ ...value, items: value.items.map(step => step.id === item.id ? next : step) })}
        onRemove={() => onChange({ ...value, items: value.items.filter(step => step.id !== item.id) })} />)}</div>
    </PlannerReorderList>
    <div className="composer-goal-step-input">
      <input aria-label="Новий крок цілі" placeholder="Наступний крок" value={newItem} maxLength={300} disabled={disabled || value.items.length >= 200} onChange={event => setNewItem(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addItem() } }} />
      <button type="button" className="planner-icon-button" aria-label="Додати крок цілі" disabled={disabled || !newItem.trim() || value.items.length >= 200} onClick={addItem}><Plus size={18} /></button>
    </div>
  </section>
}
