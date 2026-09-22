import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUp, Bell, Check, ChevronRight, MoreHorizontal, Repeat2, RotateCcw, Trash2, X } from 'lucide-react'
import { usePlanner } from '../../context/PlannerContext'
import { usePresence } from '../../hooks/usePresence'
import { useInlineDraft } from '../../hooks/useInlineDraft'
import { useComposerResize } from '../../hooks/useComposerResize'
import { useOverlayBack } from '../../hooks/useOverlayBack'
import { recurrenceLabel, shiftPlanDate } from '../../lib/planner'
import { ColorPicker } from '../ColorPicker'
import { ChoicePicker, DatePicker, TagsPicker, TimePicker } from './PlannerPickers'
import { PlannerSheet, usePlannerViewport } from './PlannerSheet'
import { PriorityPicker } from './PriorityPicker'
import { ComposerTypePicker } from './ComposerTypePicker'
import { ComposerRecordOptions } from './ComposerRecordOptions'
import { ComposerGoalSteps } from './ComposerGoalSteps'
import type { PlannerConversionInput } from '../../lib/plannerConversion'
import { emptyGoalData, type OrganizationEntry, type OrganizationEntryInput, type GoalData } from '../../types/organization'
import { mergeEditorChanges } from '../../lib/mergeEditorChanges'
import { mergeGoalItems } from '../../lib/goalItems'
import { draftInput, occurrenceChanges, draftRecurrence, REMINDERS, remindersLabel, toDraft, validateDraft, WEEKDAYS, type Draft, type Frequency } from './planDraft'
import type { TaskOccurrence } from '../../types/planner'

type EntryType = 'plan' | 'note' | 'goal'
type RecordValues = { title: string; description: string; date: string | null; tags: string[]; id?: string; data?: OrganizationEntryInput['data'] }
type OptionPanel = 'more' | 'recurrence' | 'reminders' | null
type CreateAttempt = { id: string; type: EntryType; draft: Draft; data?: OrganizationEntryInput['data'] }
type CreateDraft = { draft: Draft; type: EntryType; id: string; attempt: CreateAttempt | null; data?: OrganizationEntryInput['data'] }
type CreateResult = { attemptId: string; next: CreateDraft; message: string }
// Keyed composer instances can overlap while a request finishes. Notify the
// current create instance without retaining component state or user data here.
const createResultListeners = new Set<(result: CreateResult) => void>()
type EditScope = 'occurrence' | 'series'
type ConversionDraft = { type?: EntryType; conversion?: PlannerConversionInput | null; data?: OrganizationEntryInput['data'] }
type EditDraft = ConversionDraft & { draft: Draft; baseline: Draft; scope: EditScope; occurrence: TaskOccurrence; seriesVersion?: string }
type RecordDraft = ConversionDraft & { draft: Draft; baseline: Draft; value: OrganizationEntryInput; initial: OrganizationEntryInput; version: string }
const entryNames = { plan: 'план', note: 'нотатку', goal: 'ціль' }
const entryTitles = { plan: 'План', note: 'Нотатка', goal: 'Ціль' }
function recordInput(entry: OrganizationEntry): OrganizationEntryInput {
  return { kind: entry.kind, page_id: entry.page_id, title: entry.title, description: entry.description, date: entry.date, tags: [...entry.tags], data: structuredClone(entry.data) }
}
function recordText(entry: OrganizationEntry): Draft {
  return { ...toDraft(null, entry.date), title: entry.title, description: entry.description, tags: [...entry.tags] }
}
/** A persistent batch composer. The selected calendar date is its starting date. */
type ComposerProps = {
  open: boolean
  mode?: 'create' | 'edit'
  plan?: TaskOccurrence | null
  entry?: OrganizationEntry | null
  recordBusy?: boolean
  onUpdateRecord?: (id: string, input: OrganizationEntryInput, version: string) => Promise<unknown>
  onDeleteRecord?: (entry: OrganizationEntry) => void
  onConvert?: (input: PlannerConversionInput) => Promise<unknown>
  initialDate?: string | null
  initialType?: EntryType
  onClose: () => void
  onDelete?: (plan: TaskOccurrence) => void
  onCreateRecord?: (type: 'note' | 'goal', values: RecordValues) => Promise<void>
  onSaveGoalItems?: (id: string, before: GoalData['items'], after: GoalData['items']) => Promise<OrganizationEntry>
  availableTags?: string[]
}

export function PlannerComposer(props: ComposerProps) {
  return <ComposerSession key={props.mode === 'edit' ? `edit:${props.entry?.id ?? props.plan?.id}` : 'create'} {...props} />
}

function ComposerSession({ open, mode = 'create', plan = null, entry = null, recordBusy = false, onUpdateRecord, onDeleteRecord, onConvert, initialDate = null, initialType = 'plan', onClose, onDelete, onCreateRecord, onSaveGoalItems, availableTags = [] }: ComposerProps) {
  const { createTask, updateTask, saveOccurrence, busy, tasks } = usePlanner()
  const editing = mode === 'edit' && !!(plan || entry)
  const retained = useInlineDraft<EditDraft>(editing && plan ? `plan:${plan.id}` : null)
  const recordRetained = useInlineDraft<RecordDraft>(editing && entry ? `record:${entry.id}` : null)
  const restoredRecord = useRef(recordRetained.read())
  const initialRecordRef = useRef(restoredRecord.current?.initial ?? (entry ? recordInput(entry) : null))
  const recordVersionRef = useRef(restoredRecord.current?.version ?? entry?.updated_at)
  const [record, setRecord] = useState<OrganizationEntryInput | null>(() => restoredRecord.current?.value ?? initialRecordRef.current)
  const createRetained = useInlineDraft<CreateDraft>(editing ? null : 'composer:create')
  const restoredCreate = useRef(createRetained.read())
  const restored = useRef(retained.read())
  const occurrence = useRef(restored.current?.occurrence ?? plan).current
  const baselineRef = useRef(restoredRecord.current?.baseline ?? restored.current?.baseline ?? (entry ? recordText(entry) : toDraft(occurrence, initialDate)))
  const seriesVersionRef = useRef(restored.current?.seriesVersion ?? tasks.find(item => item.id === plan?.taskId)?.updated_at)
  const seriesBaselineRef = useRef(tasks.find(item => item.id === plan?.taskId))
  const [scopeOpen, setScopeOpen] = useState(false)
  const saveButtonRef = useRef<HTMLButtonElement>(null)
  const [scope, setScope] = useState<EditScope>(restored.current?.scope ?? 'occurrence')
  const [draft, setDraft] = useState<Draft>(() => restoredRecord.current?.draft ?? restored.current?.draft ?? restoredCreate.current?.draft ?? baselineRef.current)
  const sourceType = entry?.kind ?? 'plan'
  const [type, setType] = useState<EntryType>(editing ? restoredRecord.current?.type ?? restored.current?.type ?? sourceType : restoredCreate.current?.type ?? initialType)
  const [extraData, setExtraData] = useState<OrganizationEntryInput['data']>(() => restoredRecord.current?.data ?? restored.current?.data ?? restoredCreate.current?.data ?? { goal: emptyGoalData() })
  const conversionRef = useRef<PlannerConversionInput | null>(restoredRecord.current?.conversion ?? restored.current?.conversion ?? null)
  const [optionPanel, setOptionPanel] = useState<OptionPanel>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const pendingRef = useRef(false)
  const mountedRef = useRef(true)
  const openRef = useRef(open)
  openRef.current = open
  useLayoutEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const idRef = useRef(restoredCreate.current?.id ?? crypto.randomUUID())
  const attemptRef = useRef<CreateAttempt | null>(restoredCreate.current?.attempt ?? null)
  const wasOpenRef = useRef(false)
  const focusAfterSaveRef = useRef(false)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const typeRef = useRef(type)
  typeRef.current = type
  const id = useId()
  const present = usePresence(open, 180)
  const locked = saving || (type === 'plan' ? busy : recordBusy)
  const recurring = !!occurrence?.isRecurring
  const editingSeries = editing && recurring && scope === 'series'
  const convertingToSeries = editing && !!occurrence && !recurring && draft.frequency !== 'none'
  const retryPending = !!attemptRef.current && !saving
  const tagSuggestions = useMemo(() => [...new Set([...tasks.flatMap(task => task.tags ?? []), ...availableTags])], [tasks, availableTags])
  usePlannerViewport(rootRef, open)
  const { handleProps } = useComposerResize({ rootRef, descriptionRef, open, value: draft.description })

  useLayoutEffect(() => {
    const opening = open && !wasOpenRef.current
    wasOpenRef.current = open
    if (!open) return
    if (pendingRef.current) return
    if (!editing && !draftRef.current.title.trim() && !attemptRef.current) setDraft(current => ({ ...current, date: initialDate ?? '', time: initialDate ? current.time : '' }))
    if (opening && !editing && !draftRef.current.title.trim() && !attemptRef.current) setType(initialType)
    setOptionPanel(null)
    setError(null)
    if (!editing) titleRef.current?.focus({ preventScroll: true })
  }, [open, initialDate, initialType, editing])

  useLayoutEffect(() => {
    if (!editing || !occurrence || !open) return
    if (JSON.stringify(draft) === JSON.stringify(baselineRef.current) && type === sourceType && !conversionRef.current) retained.clear()
    else retained.write({ draft, baseline: baselineRef.current, scope, occurrence, seriesVersion: seriesVersionRef.current, type, data: extraData, conversion: conversionRef.current })
  }, [draft, scope, type, extraData, sourceType, editing, occurrence, open, retained, saving])

  useLayoutEffect(() => {
    if (!editing || !entry || !record || !initialRecordRef.current || !recordVersionRef.current || !open) return
    if (JSON.stringify(draft) === JSON.stringify(baselineRef.current) && JSON.stringify(record) === JSON.stringify(initialRecordRef.current) && type === sourceType && !conversionRef.current) recordRetained.clear()
    else recordRetained.write({ draft, baseline: baselineRef.current, value: record, initial: initialRecordRef.current, version: recordVersionRef.current, type, data: extraData, conversion: conversionRef.current })
  }, [draft, record, type, extraData, sourceType, editing, entry, open, recordRetained, saving])

  useLayoutEffect(() => {
    if (editing) return
    // A failed create keeps its UUID and frozen payload even while another
    // plan is being edited. A retry can never become a second independent insert.
    createRetained.write({ draft, type, id: idRef.current, attempt: attemptRef.current, data: extraData })
  }, [draft, type, extraData, editing, saving, createRetained])

  useEffect(() => {
    if (editing) return
    const receive = ({ attemptId, next, message }: CreateResult) => {
      if (pendingRef.current || attemptRef.current?.id !== attemptId) return
      attemptRef.current = next.attempt
      idRef.current = next.id
      draftRef.current = next.draft
      typeRef.current = next.type
      setDraft(next.draft)
      setType(next.type)
      setExtraData(next.data ?? { goal: emptyGoalData() })
      setError(null)
      setSavedMessage(message)
    }
    createResultListeners.add(receive)
    return () => { createResultListeners.delete(receive) }
  }, [editing])

  useLayoutEffect(() => {
    if (open) rootRef.current?.removeAttribute('inert')
    else rootRef.current?.setAttribute('inert', '')
    if (open && !saving && focusAfterSaveRef.current) {
      focusAfterSaveRef.current = false
      titleRef.current?.focus({ preventScroll: true })
    }
  }, [open, present, saving, type])

  useLayoutEffect(() => {
    const textarea = titleRef.current
    if (!textarea) return
    const resize = () => {
      textarea.style.overflowY = 'hidden'
      textarea.style.height = '0px'
      // A spare pixel prevents fractional line-height rounding from exposing a
      // scrollbar on otherwise empty/single-line textareas.
      const height = Math.ceil(textarea.scrollHeight) + 1
      textarea.style.height = `${Math.min(height, 100)}px`
      textarea.style.overflowY = height > 100 ? 'auto' : 'hidden'
    }
    resize()
    let width = textarea.getBoundingClientRect().width
    let frame = 0
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      const nextWidth = textarea.getBoundingClientRect().width
      if (Math.abs(nextWidth - width) < 0.5) return
      width = nextWidth
      // Changing an observed textarea's height inside observer delivery causes
      // a resize-loop warning. Initial text sizing still happens before paint;
      // viewport-driven width changes are measured on the next animation frame.
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(resize)
    }) : null
    observer?.observe(textarea)
    return () => { observer?.disconnect(); if (frame) cancelAnimationFrame(frame) }
  }, [draft.title, open])

  useEffect(() => {
    if (!savedMessage) return
    const timer = window.setTimeout(() => setSavedMessage(''), 2000)
    return () => window.clearTimeout(timer)
  }, [savedMessage])

  const close = () => {
    openRef.current = false
    setOptionPanel(null)
    // Editing is transactional from the user's point of view: closing without
    // Save discards every local field and any pending conversion draft.
    if (editing) {
      if (entry) recordRetained.clear()
      else retained.clear()
      conversionRef.current = null
    }
    onClose()
  }
  useOverlayBack(open, close, { keyboardRootRef: rootRef })

  const finishEdit = () => {
    // A late request must not close another composer or erase a newer draft.
    const cache = entry ? recordRetained : retained
    const current = cache.read()
    if (!current || (JSON.stringify(current.draft) === JSON.stringify(draft)
      && (!('value' in current) || JSON.stringify(current.value) === JSON.stringify(record)))) cache.clear()
    if (mountedRef.current && openRef.current) close()
  }

  const changeScope = (next: EditScope) => {
    if (!occurrence || next === scope) return
    const source = next === 'series' ? tasks.find(item => item.id === occurrence.taskId) : occurrence
    if (!source) { setError('Серію не знайдено. Оновіть плани.'); return }
    setScope(next)
    if (next === 'series') seriesVersionRef.current = source.updated_at
    baselineRef.current = toDraft(source)
    setDraft(baselineRef.current)
    setError(null)
  }

  const saveEdit = async (chosenScope?: EditScope) => {
    if (pendingRef.current || locked) return
    if (type !== sourceType || conversionRef.current) {
      if (!onConvert) { setError('Зміна типу зараз недоступна.'); return }
      if (!draft.title.trim()) { setError('Додайте назву запису.'); return }
      if (type === 'plan') {
        const validation = validateDraft(draft, true)
        if (validation) { setError(validation); return }
      }
      pendingRef.current = true; setSaving(true); setError(null)
      try {
        if (!conversionRef.current) {
          const baseline = draftInput(baselineRef.current)
          const edited = draftInput(draft)
          const currentTask = tasks.find(item => item.id === occurrence?.taskId)
          const current = entry ? draftInput(recordText(entry)) : draftInput(toDraft(recurring && scope === 'occurrence' ? occurrence : currentTask ?? occurrence))
          const { patch, conflicts } = mergeEditorChanges(baseline, edited, current)
          if (conflicts.length) throw new Error('Ці поля вже змінили в іншому вікні. Ваш текст залишився у чернетці.')
          const merged = { ...current, ...patch }
          const common = { title: merged.title, description: draft.description !== baselineRef.current.description ? draft.description : entry?.description ?? merged.description, date: merged.date, tags: merged.tags }
          const recordMerge = entry && record ? mergeEditorChanges(initialRecordRef.current!, record, recordInput(entry)) : null
          if (recordMerge?.conflicts.length) throw new Error('Ці властивості вже змінили в іншому вікні. Ваші зміни залишилися у чернетці.')
          // `changes` is always shaped like the source table. Destination-only
          // fields (time, priority, goal steps, ...) travel in targetChanges so
          // the RPC can validate and apply them atomically without mixing table
          // schemas.
          const changes = { ...common, ...(entry ? recordMerge?.patch : {}) }
          // Destination fields must stay sparse.  Sending the whole draft here
          // would replace a previously archived plan with composer defaults when
          // a note or goal is converted back to a plan.  The three-way patch is
          // exactly the set of destination values the user changed in this edit.
          const goalData = {
            ...(extraData.goal ?? emptyGoalData()),
            ...(sourceType === 'plan' ? { completed: draft.status === 'completed' } : {}),
          }
          const targetChanges = type === 'plan'
            ? {
                ...patch,
                ...(sourceType === 'goal' && record?.data.goal?.completed ? { status: 'completed' as const } : {}),
              }
            : type === 'goal' && (JSON.stringify(goalData) !== JSON.stringify(emptyGoalData()) || sourceType === 'plan' && draft.status === 'completed')
              ? { data: { ...extraData, goal: goalData } }
              : {}
          conversionRef.current = {
            sourceKind: sourceType, sourceId: entry?.id ?? occurrence!.taskId,
            sourceVersion: entry?.updated_at ?? (recurring && scope === 'occurrence' ? occurrence!.updated_at : currentTask?.updated_at ?? occurrence!.updated_at),
            targetKind: type, requestId: crypto.randomUUID(), changes, targetChanges,
            occurrenceDate: recurring ? occurrence?.occurrenceDate : null,
            scope, seriesVersion: currentTask?.updated_at ?? seriesVersionRef.current,
          }
          const cache = entry ? recordRetained : retained
          const cached = cache.read()
          if (cached) cache.write({ ...cached, conversion: conversionRef.current } as never)
        }
        await onConvert(conversionRef.current)
        conversionRef.current = null
        finishEdit()
      } catch (cause) { if (mountedRef.current) setError(cause instanceof Error ? cause.message : 'Не вдалося змінити тип. Спробуйте ще раз.') }
      finally { pendingRef.current = false; if (mountedRef.current) setSaving(false) }
      return
    }
    if (entry && record && recordVersionRef.current) {
      if (!draft.title.trim()) { setError('Додайте назву запису.'); return }
      pendingRef.current = true; setSaving(true); setError(null)
      try {
        if (JSON.stringify(draft) !== JSON.stringify(baselineRef.current) || JSON.stringify(record) !== JSON.stringify(initialRecordRef.current)) {
          if (!onUpdateRecord) throw new Error('Збереження запису зараз недоступне.')
          const input = { ...record, title: draft.title.trim(), description: draft.description, date: draft.date || null, tags: draft.tags }
          const baseline = { ...initialRecordRef.current!, title: baselineRef.current.title.trim(), description: baselineRef.current.description, date: baselineRef.current.date || null, tags: baselineRef.current.tags }
          const latest = recordInput(entry)
          const { patch, conflicts } = mergeEditorChanges(baseline, input, latest)
          if (conflicts.length) throw new Error('Ці поля вже змінили в іншому вікні. Ваш текст збережено як чернетку; composer можна закрити.')
          if (Object.keys(patch).length) await onUpdateRecord(entry.id, { ...latest, ...patch }, recordVersionRef.current ?? entry.updated_at)
        }
        finishEdit()
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не вдалося зберегти запис. Спробуйте ще раз.') }
      finally { pendingRef.current = false; setSaving(false) }
      return
    }
    if (!occurrence) return
    const editScope = chosenScope ?? 'occurrence'
    const input = draftInput(draft, convertingToSeries)
    const baseline = draftInput(baselineRef.current)
    const changes = mergeEditorChanges(baseline, input, baseline).patch
    const completionOnly = 'status' in changes && Object.keys(changes).every(key => key === 'status' || key === 'auto_complete')
    if (recurring && editScope === 'occurrence' && 'recurrence' in changes) {
      setError('Правило повторення можна змінити для всіх повторень.'); return
    }
    setScopeOpen(false)
    const validation = validateDraft(draft, !recurring || editScope === 'series')
    if (validation) { setError(validation); return }
    pendingRef.current = true; setSaving(true); setError(null)
    try {
      if (JSON.stringify(draft) !== JSON.stringify(baselineRef.current)) {
        if (recurring && (editScope === 'occurrence' || completionOnly)) {
          const patch = occurrenceChanges(occurrence, input)
          if (Object.keys(patch).length) await saveOccurrence(occurrence, patch)
        } else if (recurring) {
          const current = tasks.find(item => item.id === occurrence.taskId)
          if (!current || !seriesBaselineRef.current) throw new Error('Серію не знайдено. Оновіть плани.')
          // Only fields explicitly edited in this occurrence flow into the master.
          // Its projected date and existing day overrides never replace the series.
          const { status, ...shared } = changes
          const seriesBaseline = draftInput(toDraft(seriesBaselineRef.current), true)
          const latest = draftInput(toDraft(current), true)
          const { patch, conflicts } = mergeEditorChanges(seriesBaseline, { ...seriesBaseline, ...shared }, latest)
          if (conflicts.length) throw new Error('Ці поля серії вже змінили в іншому вікні. Ваші зміни залишилися у composer.')
          if (Object.keys(patch).length) await updateTask(current.id, patch, current.updated_at)
          if (status !== undefined) await saveOccurrence(occurrence, { status })
        } else {
          const current = tasks.find(item => item.id === occurrence.taskId) ?? occurrence
          const baseline = draftInput(baselineRef.current, editingSeries)
          const latest = draftInput(toDraft(current), !!current.recurrence)
          const { patch, conflicts } = mergeEditorChanges(baseline, input, latest)
          if (conflicts.length) throw new Error('Ці поля плану вже змінили в іншому вікні. Ваш текст збережено як чернетку; composer можна закрити.')
          if (Object.keys(patch).length) await updateTask(occurrence.taskId, patch, current.updated_at)
        }
      }
      finishEdit()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не вдалося зберегти план. Спробуйте ще раз.') }
    finally { pendingRef.current = false; setSaving(false) }
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (editing) { await saveEdit(); return }
    if (pendingRef.current || locked || (!draft.title.trim() && !attemptRef.current)) return
    // An unacknowledged request keeps its original UUID, type and payload.
    // Edits made after a network error remain a separate, unsent draft.
    const attempt = attemptRef.current ?? { id: idRef.current, type, draft: { ...draft, tags: [...draft.tags], reminders: [...draft.reminders], weekdays: [...draft.weekdays] }, data: structuredClone(extraData) }
    const submittedDraft = attempt.draft
    const submittedType = attempt.type
    const validation = submittedType === 'plan' ? validateDraft(submittedDraft, true) : null
    if (validation) { setError(validation); return }
    attemptRef.current = attempt
    createRetained.write({ draft: draftRef.current, type: typeRef.current, id: attempt.id, attempt, data: extraData })
    pendingRef.current = true
    setSaving(true)
    setError(null)
    try {
      if (submittedType === 'plan') {
        const input = draftInput(submittedDraft, true)
        await createTask({ ...input, id: attempt.id })
      } else {
        if (!onCreateRecord) throw new Error('Цей тип запису зараз недоступний.')
        await onCreateRecord(submittedType, { id: attempt.id, title: submittedDraft.title.trim(), description: submittedDraft.description, date: submittedDraft.date || null, tags: submittedDraft.tags, data: submittedType === 'goal' ? attempt.data : {} })
      }
      const cached = createRetained.read()
      // Another instance may already have acknowledged this same idempotent
      // request. A late retry must not replace its newer batch draft.
      if (cached && cached.id !== attempt.id) {
        attemptRef.current = cached.attempt
        idRef.current = cached.id
        setDraft(cached.draft)
        setType(cached.type)
        return
      }
      attemptRef.current = null
      idRef.current = crypto.randomUUID()
      const latest = cached?.id === attempt.id ? cached.draft : draftRef.current
      const latestType = cached?.id === attempt.id ? cached.type : typeRef.current
      const textUnchanged = JSON.stringify(latest) === JSON.stringify(submittedDraft) && latestType === submittedType
      const nextDraft = textUnchanged ? { ...toDraft(null, latest.date), priority: latest.priority, tags: latest.tags, color: latest.color } : latest
      const next = { draft: nextDraft, type: latestType, id: idRef.current, attempt: null, data: textUnchanged ? { goal: emptyGoalData() } : cached?.data ?? extraData }
      const message = !textUnchanged ? 'Попередній запис збережено. Новий текст ще не надіслано.' : submittedType === 'plan' ? 'План додано' : submittedType === 'note' ? 'Нотатку додано' : 'Ціль додано'
      createRetained.write(next)
      createResultListeners.forEach(receive => receive({ attemptId: attempt.id, next, message }))
      if (!mountedRef.current) return
      setDraft(nextDraft)
      setExtraData(next.data)
      setOptionPanel(null)
      setSavedMessage(message)
      // Text fields stay focusable throughout the request. If the description
      // was active, move to the next title in the same commit that clears it.
      focusAfterSaveRef.current = textUnchanged
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не вдалося зберегти. Текст залишився у полі — спробуйте ще раз.')
    } finally {
      pendingRef.current = false
      setSaving(false)
    }
  }

  const textKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key !== 'Enter') return
    // A virtual mobile keyboard uses Enter for a real line break. Desktop keeps
    // the established Enter-to-submit and Shift+Enter behavior.
    if (window.matchMedia('(pointer: coarse)').matches) return
    if (event.shiftKey) {
      if (event.currentTarget === titleRef.current) {
        event.preventDefault()
        requestAnimationFrame(() => descriptionRef.current?.focus({ preventScroll: true }))
      }
      return
    }
    event.preventDefault()
    void submit()
  }

  const setDate = (date: string | null, end?: string | null) => setDraft(current => ({ ...current, date: date ?? '', endDate: !date ? '' : end !== undefined ? end ?? '' : shiftPlanDate({ date: current.date || null, end_date: current.endDate || null }, date).end_date ?? '', time: date ? current.time : '', duration: date ? current.duration : '', autoComplete: date ? current.autoComplete : false, reminders: date ? current.reminders : [], frequency: date ? current.frequency : 'none' }))
  const setReminder = (minutes: number) => setDraft(current => ({ ...current, reminders: current.reminders.includes(minutes) ? current.reminders.filter(value => value !== minutes) : [...current.reminders, minutes] }))

  if (!present) return null
  return createPortal(<div ref={rootRef} className="planner-composer-position" data-state={open ? 'open' : 'closed'} aria-hidden={!open}>
    <section className="planner-composer" aria-label={editing ? `Редагування ${type === 'plan' ? 'плану' : type === 'note' ? 'нотатки' : 'цілі'}` : 'Швидке створення'} data-mode={mode} data-entry-type={type} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close() } }}>
      <div className="planner-composer-resize-handle" {...handleProps}><span /></div>
      <form onSubmit={submit} noValidate>
        <fieldset aria-busy={saving}>
        <div className="planner-composer-topline">
          {editing ? <>
            {type === 'plan' && !editingSeries && !convertingToSeries && <button type="button" role="checkbox" className="planner-icon-button" aria-checked={draft.status === 'completed'} aria-label={draft.status === 'completed' ? 'Повернути план у невиконані' : 'Виконати план'} disabled={locked} onClick={() => setDraft(current => ({ ...current, status: current.status === 'completed' ? 'planned' : 'completed', autoComplete: current.status === 'completed' ? false : current.autoComplete }))}><span className={`planner-timeline-check${draft.status === 'completed' ? ' is-checked' : ''}`}>{draft.status === 'completed' && <Check size={14} />}</span></button>}
            {type === 'goal' && record && <button type="button" role="checkbox" className="planner-icon-button" aria-checked={record.data.goal?.completed === true} aria-label={record.data.goal?.completed ? 'Повернути ціль в активні' : 'Виконати ціль'} disabled={locked} onClick={() => setRecord(current => current && ({ ...current, data: { ...current.data, goal: { ...(current.data.goal ?? emptyGoalData()), completed: !current.data.goal?.completed } } }))}><span className={`planner-timeline-check${record.data.goal?.completed ? ' is-checked' : ''}`}>{record.data.goal?.completed && <Check size={14} />}</span></button>}
            {onConvert ? <ComposerTypePicker value={type} onChange={setType} disabled={locked || !!conversionRef.current} records /> : <span className="text-xs text-text-muted">{editingSeries ? 'Серія планів' : entryTitles[type]}</span>}
          </> : <ComposerTypePicker value={type} onChange={setType} disabled={locked} records={!!onCreateRecord} />}
          <span role="status" className="planner-composer-status">{savedMessage}</span><button type="button" className="planner-icon-button" onClick={close} aria-label={editing ? `Закрити ${entryNames[type]}` : 'Закрити введення'}><X size={18} /></button>
        </div>
        <textarea ref={titleRef} id={`${id}-title`} value={draft.title} rows={1} maxLength={200} disabled={editing && locked} enterKeyHint="enter" aria-label={editing ? type === 'plan' ? 'Назва плану' : type === 'note' ? 'Назва нотатки' : 'Назва цілі' : 'Назва запису'} placeholder={type === 'note' ? 'Що хочете зберегти?' : type === 'goal' ? 'Чого хочете досягти?' : 'Що потрібно зробити?'} className="planner-composer-title" onChange={event => { setDraft(current => ({ ...current, title: event.target.value })); setSavedMessage('') }} onKeyDown={textKeyDown} />
        <textarea ref={descriptionRef} value={draft.description} rows={1} maxLength={20000} disabled={editing && locked} enterKeyHint="enter" aria-label={type === 'note' ? 'Текст нотатки' : 'Опис'} placeholder={type === 'note' ? 'Запишіть думку…' : 'Додати опис…'} className="planner-composer-description" onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} onKeyDown={event => {
          if (type === 'note' && event.key === 'Enter' && !event.ctrlKey && !event.metaKey) return
          textKeyDown(event)
        }} />
        {type === 'goal' && <ComposerGoalSteps value={(sourceType === 'goal' ? record?.data : extraData)?.goal ?? emptyGoalData()} disabled={locked} onChange={goal => {
          const previous = (sourceType === 'goal' ? record?.data : extraData)?.goal ?? emptyGoalData()
          if (sourceType === 'goal' && record) {
            setRecord(current => current && ({ ...current, data: { ...current.data, goal } }))
            if (entry?.id && onSaveGoalItems && JSON.stringify(previous.items) !== JSON.stringify(goal.items)) {
              void onSaveGoalItems(entry.id, previous.items, goal.items).then(saved => {
                if (!mountedRef.current || !saved || saved.id !== entry.id) return
                // Acknowledging one checklist snapshot must not replace edits
                // made while it was saving, or mark unrelated fields as saved.
                setRecord(current => {
                  if (!current || current.kind !== 'goal') return current
                  if (recordVersionRef.current && saved.updated_at < recordVersionRef.current) return current
                  const currentGoal = current.data.goal ?? emptyGoalData()
                  const savedItems = saved.data.goal?.items ?? []
                  let items = currentGoal.items
                  try { items = mergeGoalItems(goal.items, currentGoal.items, savedItems) }
                  catch { /* A queued save reports conflicting edits; retain the local draft. */ }
                  const initial = initialRecordRef.current!
                  initialRecordRef.current = { ...initial, data: { ...initial.data, goal: { ...(initial.data.goal ?? emptyGoalData()), items: savedItems } } }
                  recordVersionRef.current = saved.updated_at
                  return { ...current, data: { ...current.data, goal: { ...currentGoal, items } } }
                })
              }).catch(failure => mountedRef.current && setError(failure instanceof Error ? failure.message : 'Не вдалося зберегти кроки цілі.'))
            }
          } else setExtraData(current => ({ ...current, goal }))
        }} />}
        {editing && recurring && type !== 'plan' && <ChoicePicker<EditScope> label="Область зміни типу" value={scope} disabled={locked || !!conversionRef.current} onChange={setScope} options={[{ value: 'occurrence', label: 'Тільки це повторення' }, { value: 'series', label: 'Уся серія' }]} />}
        {error && <p role="alert" className="planner-composer-error">{error}{retryPending && <span className="block mt-1">«Повторити» перевірить збереження попереднього запису. Зміни в полі залишаться для наступного створення.</span>}</p>}
        <div className="planner-composer-toolbar" data-date-range={type === 'plan' && !!draft.endDate || undefined}><div className="planner-composer-parameters">
          {type !== 'goal' && <DatePicker compact value={draft.date || null} endValue={type === 'plan' ? draft.endDate : null} onRangeChange={type === 'plan' ? setDate : undefined} disabled={locked} onChange={setDate} />}
          {type === 'plan' && <><TimePicker compact value={draft.time || null} autoComplete={draft.autoComplete} onAutoCompleteChange={autoComplete => setDraft(current => ({ ...current, autoComplete }))} duration={draft.duration ? Number(draft.duration) : null} onDurationChange={duration => setDraft(current => ({ ...current, duration: duration ? String(duration) : '' }))} disabled={!draft.date || locked} onChange={time => setDraft(current => ({ ...current, time: time ?? '', duration: time ? current.duration : '', autoComplete: time ? current.autoComplete : false }))} /><PriorityPicker value={draft.priority} onChange={priority => setDraft(current => ({ ...current, priority }))} disabled={locked} /></>}
          <TagsPicker compact value={draft.tags} disabled={locked} onChange={tags => setDraft(current => ({ ...current, tags }))} suggestions={tagSuggestions} />
          {(type === 'plan' || (editing && type === sourceType)) && <button type="button" disabled={locked} data-active={type === 'plan' && (draft.frequency !== 'none' || draft.reminders.length > 0) || undefined} className="planner-parameter planner-parameter-icon" aria-label="Додаткові параметри" aria-haspopup="dialog" onClick={() => setOptionPanel('more')}><MoreHorizontal size={19} /></button>}
        </div><button ref={saveButtonRef} type="submit" className={`planner-composer-send${retryPending ? ' is-retry' : ''}`} disabled={(!draft.title.trim() && !retryPending) || locked} aria-label={saving ? 'Збереження' : editing ? `Зберегти ${entryNames[type]}` : retryPending ? 'Повторити збереження попереднього запису' : 'Створити запис'} onPointerDown={event => {
          // Keeping focus on the textarea avoids closing the virtual keyboard.
          // Pointer click still submits; keyboard activation keeps its normal path.
          event.preventDefault()
        }}>{editing ? <Check size={21} /> : retryPending ? <><RotateCcw size={17} /><span>Повторити</span></> : <ArrowUp size={21} />}</button></div>
        </fieldset>
      </form>
    </section>
    <PlannerSheet open={optionPanel !== null} className={optionPanel === 'reminders' ? 'planner-reminders-sheet' : undefined} title={optionPanel === 'reminders' ? 'Нагадування' : optionPanel === 'recurrence' ? 'Повторення' : 'Додатково'} onClose={() => setOptionPanel(null)} footer={optionPanel !== 'more' ? <button type="button" className="planner-solid-button" onClick={() => setOptionPanel(null)}>Готово</button> : undefined}>
      {optionPanel === 'more' && <div className="planner-composer-extras">
        {type === 'plan' && <><button type="button" className="planner-setting-row" data-active={draft.reminders.length > 0 || undefined} disabled={!draft.date || locked} onClick={() => setOptionPanel('reminders')}><Bell size={18} /><span>Нагадування<small>{remindersLabel(draft.reminders)}</small></span><ChevronRight size={16} /></button>
        <button type="button" className="planner-setting-row" data-active={draft.frequency !== 'none' || undefined} disabled={!draft.date || locked} onClick={() => setOptionPanel('recurrence')}><Repeat2 size={18} /><span>Повторення<small>{recurrenceLabel(draftRecurrence(draft))}</small></span><ChevronRight size={16} /></button>
        {!draft.date && <p className="planner-field-hint">Оберіть дату, щоб увімкнути повторення та нагадування.</p>}
        <div><p className="planner-field-label">Колір</p><ColorPicker value={draft.color} onChange={color => setDraft(current => ({ ...current, color }))} /></div></>}
        {entry && record && type === sourceType && <ComposerRecordOptions entry={entry} value={record} onChange={setRecord} disabled={locked} />}
        {editing && <div className="flex items-center justify-between gap-2 border-t border-border pt-2"><button type="button" className="planner-plain-button text-text-muted" disabled={locked} onClick={() => { retained.clear(); recordRetained.clear(); close() }}>Скасувати зміни</button>{occurrence && onDelete && <button type="button" className="planner-plain-button inline-flex items-center gap-2 text-danger" disabled={locked} onClick={() => onDelete(occurrence)}><Trash2 size={17} />Видалити план</button>}{entry?.kind === 'goal' && onDeleteRecord && <button type="button" className="planner-plain-button inline-flex items-center gap-2 text-danger" disabled={locked} onClick={() => onDeleteRecord(entry)}><Trash2 size={17} />Видалити ціль</button>}</div>}
      </div>}
      {optionPanel === 'reminders' && <div className="planner-reminder-options" role="group" aria-label="Нагадування"><button type="button" aria-label="Без нагадування" aria-pressed={!draft.reminders.length} onClick={() => setDraft(current => ({ ...current, reminders: [] }))}>Без</button>{REMINDERS.map(reminder => <button type="button" key={reminder.value} aria-label={reminder.label} aria-pressed={draft.reminders.includes(reminder.value)} onClick={() => setReminder(reminder.value)}>{reminder.value === 0 ? 'Вчасно' : reminder.label.replace(/^За /, '')}</button>)}</div>}
      {optionPanel === 'recurrence' && <div className="planner-composer-extras">
        <ChoicePicker<Frequency> disabled={locked} label="Частота повторення" value={draft.frequency} onChange={frequency => setDraft(current => ({ ...current, frequency }))} options={[{ value: 'none', label: 'Не повторювати' }, { value: 'daily', label: 'Щодня' }, { value: 'weekly', label: 'Щотижня' }, { value: 'monthly', label: 'Щомісяця' }, { value: 'weekdays', label: 'У вибрані дні тижня' }]} />
        {draft.frequency !== 'none' && <><label className="planner-text-field">{draft.frequency === 'daily' ? 'Кожні N днів' : draft.frequency === 'monthly' ? 'Кожні N місяців' : 'Кожні N тижнів'}<input inputMode="numeric" maxLength={4} value={draft.interval} onChange={event => setDraft(current => ({ ...current, interval: event.target.value.replace(/\D/g, '') }))} /></label>
          {draft.frequency === 'weekdays' && <div className="planner-repeat-week" role="group" aria-label="Дні повторення">{WEEKDAYS.map(day => <button type="button" key={day.value} aria-label={day.label} aria-pressed={draft.weekdays.includes(day.value)} onClick={() => setDraft(current => ({ ...current, weekdays: current.weekdays.includes(day.value) ? current.weekdays.filter(value => value !== day.value) : [...current.weekdays, day.value] }))}>{day.short}</button>)}</div>}
          <div><p className="planner-field-label">Кінцева дата</p><DatePicker value={draft.until || null} min={draft.date || undefined} onChange={until => setDraft(current => ({ ...current, until: until ?? '' }))} /><p className="planner-field-hint">Без дати — повторення без кінця.{draft.frequency === 'monthly' && ' У коротших місяцях — останній день місяця.'}</p></div></>}
      </div>}
    </PlannerSheet>
    <PlannerSheet open={open && scopeOpen} title="Застосувати зміни" onClose={() => setScopeOpen(false)}>
      <div className="planner-choice-list" role="group" aria-label="Область зміни">
        <button type="button" onClick={() => { void saveEdit('occurrence') }}>Тільки цей день</button>
        <button type="button" onClick={() => { void saveEdit('series') }}>Усі повторення</button>
      </div>
    </PlannerSheet>
  </div>, document.body)
}
