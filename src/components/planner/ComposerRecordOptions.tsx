import { useOrganization } from '../../context/OrganizationContext'
import { emptyGoalData, type GoalData, type GoalPeriod, type OrganizationEntry, type OrganizationEntryInput } from '../../types/organization'
import { ChoicePicker, DatePicker } from './PlannerPickers'
import { Input } from '../ui'

/** Type-specific properties only. Text and saving belong to the shared composer. */
export function ComposerRecordOptions({ entry, value, onChange, disabled }: {
  entry: OrganizationEntry; value: OrganizationEntryInput; onChange: (value: OrganizationEntryInput) => void; disabled?: boolean
}) {
  const { pages } = useOrganization()
  const allowedPages = pages.filter(page => page.kind === 'mixed' || page.kind === (entry.kind === 'note' ? 'notes' : 'goals'))
  const goal = value.data.goal ?? emptyGoalData()
  const setGoal = (patch: Partial<GoalData>) => onChange({ ...value, data: { ...value.data, goal: { ...goal, ...patch } } })
  return <>
    {allowedPages.length > 0 && <ChoicePicker label="Сторінка" value={value.page_id ?? ''} onChange={page => onChange({ ...value, page_id: page || null })} disabled={disabled} options={[{ value: '', label: entry.kind === 'note' ? 'Усі нотатки' : 'Усі цілі' }, ...allowedPages.map(page => ({ value: page.id, label: page.title }))]} />}
    {entry.kind === 'goal' && <>
      <ChoicePicker<GoalPeriod> label="Період цілі" value={goal.period} disabled={disabled} options={[{ value: 'none', label: 'Без терміну' }, { value: 'year', label: 'На рік' }, { value: 'custom', label: 'Свій період' }]} onChange={period => setGoal({ period, year: period === 'year' ? goal.year ?? new Date().getFullYear() : null, startDate: period === 'custom' ? goal.startDate : null, endDate: period === 'custom' ? goal.endDate : null })} />
      {goal.period === 'year' && <label className="planner-text-field">Рік<Input inputMode="numeric" maxLength={4} value={goal.year ?? ''} disabled={disabled} onChange={event => setGoal({ year: event.target.value.replace(/\D/g, '') ? Number(event.target.value.replace(/\D/g, '')) : null })} /></label>}
      {goal.period === 'custom' && <div className="organization-period-dates"><div><p className="planner-field-label">Початок</p><DatePicker value={goal.startDate} disabled={disabled} allowEmpty={false} onChange={startDate => setGoal({ startDate, endDate: startDate && goal.endDate && goal.endDate < startDate ? startDate : goal.endDate })} /></div><div><p className="planner-field-label">Завершення</p><DatePicker value={goal.endDate} min={goal.startDate ?? undefined} disabled={disabled} allowEmpty={false} onChange={endDate => setGoal({ endDate })} /></div></div>}

    </>}
    <p className="text-xs text-text-muted">Оновлено {new Date(entry.updated_at).toLocaleDateString('uk-UA')}</p>
  </>
}
