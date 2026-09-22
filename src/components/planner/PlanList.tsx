import { useEffect, useRef, useState, type ComponentProps, type DragEvent, type ReactNode } from 'react'
import type { TaskOccurrence } from '../../types/planner'
import { usePlanner } from '../../context/PlannerContext'
import { PlannerReorderList, usePlannerSortable } from './PlannerReorderList'
import { TaskRow } from './TaskRow'

type RowProps = Omit<ComponentProps<typeof TaskRow>, 'task' | 'timeline'>

function SortablePlan({ task, children, disabled }: { task: TaskOccurrence; children: ReactNode; disabled: boolean }) {
  const sortable = usePlannerSortable(task.id, disabled)
  return <div ref={sortable.setNodeRef} {...sortable.attributes} {...sortable.listeners}
    style={sortable.style} className="planner-timeline-item" data-plan-id={task.id} aria-label={`Перемістити план: ${task.title}`}>
    {children}
  </div>
}

/** Native desktop dragging also continues to work with calendar day targets. */
export function PlanList({ tasks, renderEditor, ...rowProps }: RowProps & { tasks: TaskOccurrence[]; renderEditor?: (task: TaskOccurrence) => ReactNode }) {
  const { reorderOccurrences } = usePlanner()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [optimisticIds, setOptimisticIds] = useState<string[] | null>(null)
  useEffect(() => {
    if (optimisticIds && (!saving || optimisticIds.every((id, index) => tasks[index]?.id === id))) setOptimisticIds(null)
  }, [tasks, optimisticIds, saving])
  const displayed = optimisticIds ? [...tasks].sort((a, b) => {
    const ai = optimisticIds.indexOf(a.id), bi = optimisticIds.indexOf(b.id)
    return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi)
  }) : tasks
  const nativeId = useRef<string | null>(null)
  const pending = useRef(false)
  const suppressClickUntil = useRef(0)
  const disabled = !!rowProps.busy || saving
  const groupForId = (id: string) => {
    const task = tasks.find(task => task.id === id)
    return task?.status === 'completed' ? `completed:${id}` : task?.priority ?? ''
  }
  const reorder = async (ids: string[]) => {
    if (pending.current || disabled) return
    const changed = ids.find((id, index) => id !== tasks[index]?.id)
    if (!changed) return
    const priority = groupForId(changed)
    if (ids.some((id, index) => groupForId(id) !== groupForId(tasks[index]?.id))) return
    const cohort = ids.map(id => tasks.find(task => task.id === id)!).filter(task => task?.priority === priority)
    pending.current = true; setSaving(true); setError('')
    setOptimisticIds(ids)
    try { await reorderOccurrences(cohort) }
    catch (failure) { setOptimisticIds(null); setError(failure instanceof Error ? failure.message : 'Не вдалося зберегти порядок планів.') }
    finally { pending.current = false; setSaving(false) }
  }
  const targetId = (event: DragEvent) => (event.target as Element).closest<HTMLElement>('[data-plan-id]')?.dataset.planId
  const canDrop = (event: DragEvent) => {
    const source = nativeId.current, target = targetId(event)
    return !disabled && source && target && groupForId(source) === groupForId(target)
  }
  return <>
    <PlannerReorderList ids={displayed.map(task => task.id)} onReorder={reorder} disabled={disabled} touchOnly groupForId={groupForId}>
      <div className="planner-timeline" onDragStartCapture={event => { nativeId.current = targetId(event) ?? null }}
        onDragEnd={() => { nativeId.current = null; suppressClickUntil.current = Date.now() + 400 }}
        onClickCapture={event => { if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation() } }}
        onDragOver={event => { if (canDrop(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
        onDrop={event => {
          if (!canDrop(event)) return
          event.preventDefault(); event.stopPropagation()
          const ids = tasks.map(task => task.id), from = ids.indexOf(nativeId.current!), to = ids.indexOf(targetId(event)!)
          nativeId.current = null; suppressClickUntil.current = Date.now() + 400
          if (from < 0 || to < 0 || from === to) return
          ids.splice(to, 0, ids.splice(from, 1)[0]); void reorder(ids)
        }}>
        {displayed.map(task => <SortablePlan key={task.id} task={task} disabled={disabled || task.status === 'completed'}>
          {renderEditor?.(task) ?? <TaskRow {...rowProps} task={task} timeline />}
        </SortablePlan>)}
      </div>
    </PlannerReorderList>
    {error && <p role="alert" className="planner-composer-error">{error}</p>}
  </>
}
