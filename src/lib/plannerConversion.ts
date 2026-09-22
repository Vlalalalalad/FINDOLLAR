import { supabase } from './supabase'
import type { Task, TaskInput, TaskOverride, TaskRecurrence } from '../types/planner'
import type { OrganizationEntry, OrganizationEntryInput } from '../types/organization'

export type PlannerEntryKind = 'plan' | 'note' | 'goal'
export interface PlannerConversionInput {
  sourceKind: PlannerEntryKind
  sourceId: string
  sourceVersion: string
  targetKind: PlannerEntryKind
  /** Keep this UUID and the same payload when retrying an uncertain request. */
  requestId: string
  changes: Partial<TaskInput | OrganizationEntryInput>
  /** Sparse edits made to parameters of the destination type before saving. */
  targetChanges?: Partial<TaskInput | OrganizationEntryInput>
  occurrenceDate?: string | null
  scope?: 'occurrence' | 'series'
  seriesVersion?: string | null
}
export interface ConversionStoredTask extends Omit<Task, 'status' | 'recurrence'> {
  status: 'planned' | 'in_progress' | 'done' | 'postponed'
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly'
  recurrence_rule: TaskRecurrence | null
  date_initialized: boolean
}
export interface PlannerConversionResult {
  sourceKind: PlannerEntryKind
  sourceId: string
  sourceRemoved: boolean
  targetKind: PlannerEntryKind
  targetId: string
  task?: ConversionStoredTask
  entry?: OrganizationEntry
  /** Only one exception is persisted when a selected recurrence is converted. */
  override?: TaskOverride
  /** Bounded, previously persisted exceptions restored with a whole series. */
  overrides?: TaskOverride[]
}

/** Type conversion is one server transaction; never create then delete in the UI. */
export async function convertPlannerEntry(input: PlannerConversionInput): Promise<PlannerConversionResult> {
  const { data, error } = await supabase.rpc('convert_planner_entry', {
    p_source_kind: input.sourceKind, p_source_id: input.sourceId,
    p_expected_updated_at: input.sourceVersion, p_target_kind: input.targetKind,
    p_request_id: input.requestId, p_changes: input.changes,
    p_occurrence_date: input.occurrenceDate ?? null, p_scope: input.scope ?? 'occurrence',
    p_series_updated_at: input.seriesVersion ?? null,
    p_target_changes: input.targetChanges ?? {},
  })
  if (error) {
    const message = String(error.message ?? error)
    if (/schema cache|does not exist|could not find.*convert_planner_entry/i.test(message)) throw new Error('Зміна типу ще не підключена до бази даних. Потрібне оновлення сервера.')
    if (/already changed|source not found/i.test(message)) throw new Error('Запис уже змінено або видалено. Закрийте його та відкрийте повторно; текст чернетки збережено.')
    if (/not authenticated|permission denied|row-level security/i.test(message)) throw new Error('Немає доступу до запису. Увійдіть у застосунок повторно.')
    if (/invalid|constraint|out of range/i.test(message)) throw new Error('Перевірте текст, дату й параметри запису перед зміною типу.')
    throw new Error(message)
  }
  if (!data?.targetId || (!data.task && !data.entry)) throw new Error('Сервер не підтвердив зміну типу. Повторіть спробу.')
  return data as PlannerConversionResult
}
