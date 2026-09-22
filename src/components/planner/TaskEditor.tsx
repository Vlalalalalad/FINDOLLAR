import { useRef, useState } from 'react'
import { usePlanner } from '../../context/PlannerContext'
import { useInlineDraft } from '../../hooks/useInlineDraft'
import type { TaskOccurrence } from '../../types/planner'
import type { OrganizationEntry, OrganizationEntryInput } from '../../types/organization'
import type { PlannerConversionInput } from '../../lib/plannerConversion'
import { PlannerSheet } from './PlannerSheet'
import { PlannerComposer } from './PlannerComposer'

/** Compatibility entry point: all editing uses the universal composer. */
export function TaskEditor({ open, occurrence = null, initialDate, initialAction = 'edit', onClose, onConvert, onUpdateRecord, onDeleteRecord, onSaveGoalItems, availableTags }: {
  open: boolean
  occurrence?: TaskOccurrence | null
  initialDate?: string | null
  initialAction?: 'details' | 'edit' | 'delete'
  inline?: boolean
  onClose: () => void
  onConvert?: (input: PlannerConversionInput) => Promise<unknown>
  onUpdateRecord?: (id: string, input: OrganizationEntryInput, version: string) => Promise<unknown>
  onDeleteRecord?: (entry: OrganizationEntry) => void
  onSaveGoalItems?: (id: string, before: NonNullable<OrganizationEntry['data']['goal']>['items'], after: NonNullable<OrganizationEntry['data']['goal']>['items']) => Promise<OrganizationEntry>
  availableTags?: string[]
}) {
  if (initialAction === 'delete') return open && occurrence ? <DeletePlanSession key={occurrence.id} occurrence={occurrence} onClose={onClose} /> : null
  return <PlannerComposer open={open} mode={occurrence ? 'edit' : 'create'} plan={occurrence} initialDate={initialDate} onClose={onClose}
    onConvert={onConvert} onUpdateRecord={onUpdateRecord} onDeleteRecord={onDeleteRecord} onSaveGoalItems={onSaveGoalItems} availableTags={availableTags} />
}

/** Closing deletion always returns to the list, never to an editor. */
function DeletePlanSession({ occurrence, onClose }: { occurrence: TaskOccurrence; onClose: () => void }) {
  const { tasks, busy, deleteTask, deleteOccurrence } = usePlanner()
  const retained = useInlineDraft(`plan:${occurrence.id}`)
  const [scope, setScope] = useState<'occurrence' | 'series' | null>(occurrence.isRecurring ? null : 'series')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const version = useRef(tasks.find(task => task.id === occurrence.taskId)?.updated_at)
  const close = () => { if (!inFlight.current) onClose() }
  const remove = async () => {
    if (!scope || inFlight.current || busy) return
    inFlight.current = true; setSaving(true); setError('')
    try {
      if (occurrence.isRecurring && scope === 'occurrence') await deleteOccurrence(occurrence)
      else await deleteTask(occurrence.taskId, occurrence.isRecurring ? version.current : occurrence.updated_at)
      retained.clear()
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не вдалося видалити план. Спробуйте ще раз.') }
    finally { inFlight.current = false; setSaving(false) }
  }
  return <PlannerSheet open title={!scope ? 'Що видалити?' : occurrence.isRecurring && scope === 'series' ? 'Видалити всю серію?' : occurrence.isRecurring ? 'Видалити це повторення?' : 'Видалити план?'} onClose={close}
    footer={scope ? <button type="button" className="planner-solid-button !bg-danger" disabled={saving || busy} onClick={() => void remove()}>{saving ? 'Видалення…' : occurrence.isRecurring && scope === 'series' ? 'Видалити всю серію' : 'Видалити'}</button> : undefined}>
    <p className="break-words text-sm font-semibold text-text">{occurrence.title}</p>
    {!scope ? <div className="planner-choice-list mt-3">
      <button type="button" disabled={saving || busy} onClick={() => setScope('occurrence')}>Видалити це повторення</button>
      <button type="button" className="text-danger" disabled={saving || busy} onClick={() => setScope('series')}>Видалити всю серію</button>
    </div> : <p className="mt-3 text-sm text-text-muted">{occurrence.isRecurring && scope === 'series' ? 'Буде видалено серію та її повторення.' : occurrence.isRecurring ? 'Інші повторення серії залишаться.' : 'Цю дію неможливо скасувати.'}</p>}
    {error && <p role="alert" className="planner-composer-error mt-3">{error}</p>}
  </PlannerSheet>
}
