import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, FilePlus2, Plus, Search } from 'lucide-react'
import { Button, Input } from '../components/ui'
import { usePlanner } from '../context/PlannerContext'
import { useOrganization } from '../context/OrganizationContext'
import { useAuth } from '../context/AuthContext'
import { usePlannerClock } from '../hooks/usePlannerClock'
import { useInlineDraft } from '../hooks/useInlineDraft'
import { usePressFeedback } from '../hooks/usePressFeedback'
import { usePlannerWorkspaceScroll, usePlannerWorkspaceState } from '../hooks/usePlannerWorkspace'
import { expandTasks, localDateKey, occursOnDate, parseLocalDate, sortOccurrences } from '../lib/planner'
import type { TaskOccurrence, TaskPriority } from '../types/planner'
import type { OrganizationEntry } from '../types/organization'
import { PlannerCalendar, calendarDays } from '../components/planner/PlannerCalendar'
import { PlannerBrowse } from '../components/planner/PlannerBrowse'
import { PlanList } from '../components/planner/PlanList'
import { TaskEditor } from '../components/planner/TaskEditor'
import { PlannerComposer } from '../components/planner/PlannerComposer'
import { PlannerSheet } from '../components/planner/PlannerSheet'
import { ChoicePicker } from '../components/planner/PlannerPickers'
import { TaskQuickActions } from '../components/planner/TaskQuickActions'
import { OrganizationView, OrganizationEntryRow } from '../components/planner/OrganizationView'
import { convertPlannerEntry, type PlannerConversionInput } from '../lib/plannerConversion'
import '../components/planner/planner.css'
import '../components/planner/workspace.css'

type EditorState = { occurrence: TaskOccurrence; action: 'details' | 'edit' | 'delete' }
type Space = 'plans' | 'notes' | 'goals' | string
type WorkspaceSelection = { kind: 'create' } | { kind: 'record'; id: string }
  | { kind: 'plan'; taskId: string; occurrenceDate: string | null } | null

export function Plans() {
  const { tasks, overrides, loading, error, busy, refresh, toggleOccurrence, saveOccurrence, updateTask, acceptConversion: acceptTaskConversion } = usePlanner()
  const { user } = useAuth()
  const organization = useOrganization()
  const now = usePlannerClock()
  const today = localDateKey(now)
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const handledPush = useRef('')
  const rootRef = useRef<HTMLDivElement>(null)
  const [space, setSpace] = usePlannerWorkspaceState<Space>('navigation:space', 'plans')
  const [homeRequest] = usePlannerWorkspaceState('home-request', 0)
  const handledHomeRequest = useRef(homeRequest)
  const [menu, setMenu] = useState(false)
  const press = usePressFeedback()
  const [newPage, setNewPage] = useState(false)
  const [pageTitle, setPageTitle] = useState('')
  const [pageKind, setPageKind] = useState<'notes' | 'goals' | 'mixed'>('mixed')
  const [pageSaving, setPageSaving] = useState(false)
  const [pageError, setPageError] = useState('')
  const [browsing, setBrowsing] = usePlannerWorkspaceState('navigation:browsing', false)
  const [browseUndated, setBrowseUndated] = useState(false)
  const [expanded, setExpanded] = usePlannerWorkspaceState('calendar:expanded', false)
  const [selected, setSelected] = usePlannerWorkspaceState('calendar:selected', today)
  const [visibleCount, setVisibleCount] = usePlannerWorkspaceState('calendar:visible-count', 60)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [quickTask, setQuickTask] = useState<TaskOccurrence | null>(null)
  const viewKey = space === 'plans' && browsing ? 'browse' : space
  const [selection, setSelection] = usePlannerWorkspaceState<WorkspaceSelection>(`selection:${viewKey}`, null)
  const [, setHomeSelection] = usePlannerWorkspaceState<WorkspaceSelection>('selection:plans', null)
  const note = selection?.kind === 'record' ? organization.entries.find(entry => entry.id === selection.id) ?? null : null
  const selectedPlan = useMemo(() => {
    if (selection?.kind !== 'plan') return null
    const task = tasks.find(item => item.id === selection.taskId)
    if (!task) return null
    // Saved exceptions retain their identity even after recurrence is disabled.
    const retainedException = overrides.some(item => item.task_id === task.id && item.occurrence_date === selection.occurrenceDate)
    const originalDate = task.recurrence || retainedException ? selection.occurrenceDate : task.date
    const override = overrides.filter(item => item.task_id === task.id && item.occurrence_date === originalDate)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id))[0]
    const effectiveDate = override?.patch.date !== undefined ? override.patch.date : originalDate
    const date = effectiveDate ?? today
    return expandTasks([task], overrides, date, date).find(item => item.occurrenceDate === originalDate) ?? null
  }, [selection, tasks, overrides, today])
  const [recordDelete, setRecordDelete] = useState<OrganizationEntry | null>(null)
  const [deletingRecord, setDeletingRecord] = useState(false)
  const deletingRecordRef = useRef(false)
  const deletedDraft = useInlineDraft(recordDelete ? `record:${recordDelete.id}` : null)
  const recordDestinations = useRef(new Map<string, string | null>())
  const month = selected.slice(0, 7) + '-01'
  const page = organization.pages.find(item => item.id === space)
  const title = space === 'plans' ? 'Плани' : space === 'notes' ? 'Нотатки' : space === 'goals' ? 'Цілі' : page?.title ?? 'Сторінка'
  const plannerLoadError = space === 'plans' ? error : null
  const visibleError = plannerLoadError || actionError
  const loginRequired = !!plannerLoadError && /сесію.*увійдіть/i.test(plannerLoadError)
  const composerOpen = selection?.kind === 'create' || !!selectedPlan || !!note
  usePlannerWorkspaceScroll(rootRef, viewKey, space === 'plans' ? !loading && !error : !organization.loading && !organization.error)
  const selectDay = useCallback((date: string) => { setSelected(date); setVisibleCount(60) }, [setSelected, setVisibleCount])
  useEffect(() => {
    // Restore identities, never stale deleted records or destructive dialogs.
    if (selection?.kind === 'record' && !organization.loading && !organization.error && !note) setSelection(null)
    if (selection?.kind === 'plan' && !loading && !error && !selectedPlan) setSelection(null)
    if (!organization.loading && !organization.error && !['plans', 'notes', 'goals'].includes(space) && !page) {
      setSpace('plans'); setBrowsing(false)
    }
  }, [selection, note, selectedPlan, organization.loading, organization.error, loading, error, space, page, setSelection, setSpace, setBrowsing])
  useEffect(() => {
    if (params.get('view') === 'today') { selectDay(localDateKey(new Date())); setSpace('plans'); setBrowsing(false) }
    const date = params.get('date')
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      try { parseLocalDate(date); selectDay(date); setSpace('plans'); setBrowsing(false) } catch { /* Ignore malformed notification URLs. */ }
    }
  }, [location.key, params, selectDay])
  useEffect(() => {
    if (!user || loading || error || location.pathname !== '/plans') return
    const target = params.get('pushAccount')
    const taskId = params.get('task')
    const occurrence = params.get('occurrence')
    const effectiveDate = params.get('date')
    const signature = location.search
    if (!target || target !== user.id || handledPush.current === signature) return
    if (!taskId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) return
    const validOccurrence = occurrence && /^\d{4}-\d{2}-\d{2}$/.test(occurrence) ? occurrence : null
    const validDate = effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) ? effectiveDate : null
    try {
      if (validOccurrence) parseLocalDate(validOccurrence)
      if (validDate) { parseLocalDate(validDate); selectDay(validDate) }
    } catch { return }
    setSpace('plans')
    setBrowsing(false)
    const task = tasks.find(item => item.id === taskId)
    if (task) setHomeSelection({ kind: 'plan', taskId, occurrenceDate: validOccurrence ?? task.date })
    handledPush.current = signature
    navigate('/plans', { replace: true })
  }, [user?.id, loading, error, location.pathname, location.search, params, tasks, navigate, selectDay, setSpace, setBrowsing, setHomeSelection])
  const calendarTasks = useMemo(() => {
    const days = calendarDays(month)
    return expandTasks(tasks, overrides, days[0], days[41])
  }, [tasks, overrides, month])
  const dayTasks = useMemo(() => sortOccurrences(calendarTasks.filter(task => occursOnDate(task, selected)), now), [calendarTasks, selected, now])
  const datedNotes = useMemo(() => organization.entries.filter(entry => entry.kind === 'note' && entry.date === selected), [organization.entries, selected])
  const availableTags = useMemo(() => [...new Set([...tasks.flatMap(task => task.tags ?? []), ...organization.entries.flatMap(entry => entry.tags)])], [tasks, organization.entries])
  const openTask = useCallback((occurrence: TaskOccurrence) => { setEditor(null); setSelection({ kind: 'plan', taskId: occurrence.taskId, occurrenceDate: occurrence.occurrenceDate }) }, [setSelection])
  const openRecord = useCallback((entry: OrganizationEntry) => { setEditor(null); setSelection({ kind: 'record', id: entry.id }) }, [setSelection])
  const deleteTask = useCallback((occurrence: TaskOccurrence) => { setSelection(null); setEditor({ occurrence, action: 'delete' }) }, [setSelection])
  const deleteRecord = useCallback((entry: OrganizationEntry) => { setSelection(null); setRecordDelete(entry); setActionError(null) }, [setSelection])
  const toggle = useCallback(async (task: TaskOccurrence) => {
    setActionError(null)
    try { await toggleOccurrence(task) } catch (err) { setActionError(err instanceof Error ? err.message : 'Не вдалося змінити статус.') }
  }, [toggleOccurrence])
  const changePriority = useCallback(async (task: TaskOccurrence, priority: TaskPriority, scope?: 'occurrence' | 'series') => {
    if (task.isRecurring && scope !== 'series') await saveOccurrence(task, { priority })
    else await updateTask(task.taskId, { priority }, task.isRecurring ? tasks.find(item => item.id === task.taskId)?.updated_at : task.updated_at)
  }, [saveOccurrence, updateTask, tasks])
  const move = useCallback(async (task: TaskOccurrence, date: string) => {
    if (task.isRecurring) await saveOccurrence(task, { date })
    else await updateTask(task.taskId, { date }, task.updated_at)
    selectDay(date)
  }, [saveOccurrence, updateTask, selectDay])
  const calendarMove = useCallback((task: TaskOccurrence, date: string) => {
    setActionError(null)
    void move(task, date).catch(err => setActionError(err instanceof Error ? err.message : 'Не вдалося перенести план.'))
  }, [move])
  const chooseSpace = useCallback((next: Space) => {
    if (next === 'plans' && (space !== 'plans' || browsing)) setHomeSelection(null)
    setSpace(next); setMenu(false); setBrowsing(false); setEditor(null); setQuickTask(null); setRecordDelete(null); setActionError(null)
  }, [space, browsing, setSpace, setBrowsing, setHomeSelection])
  useLayoutEffect(() => {
    if (handledHomeRequest.current === homeRequest) return
    handledHomeRequest.current = homeRequest
    if (space !== 'plans' || browsing) chooseSpace('plans')
  }, [homeRequest, space, browsing, chooseSpace])
  const createRecord = async (kind: 'note' | 'goal', values: { id?: string; title: string; description: string; date: string | null; tags: string[]; data?: OrganizationEntry['data'] }) => {
    const destination = page && (page.kind === 'mixed' || page.kind === (kind === 'note' ? 'notes' : 'goals')) ? page.id : null
    if (values.id && !recordDestinations.current.has(values.id)) recordDestinations.current.set(values.id, destination)
    await organization.createEntry({
      ...values, kind, page_id: values.id ? recordDestinations.current.get(values.id) ?? null : destination,
      date: kind === 'note' ? values.date : null,
      data: kind === 'goal' ? values.data ?? { goal: { period: 'none', year: null, startDate: null, endDate: null, items: [] } } : {},
    })
    if (values.id) recordDestinations.current.delete(values.id)
  }
  const convertEntry = useCallback(async (input: PlannerConversionInput) => {
    const result = await convertPlannerEntry(input)
    // Both contexts acknowledge the same atomic RPC result before refreshing;
    // this prevents the old source row from flashing back from a stale read.
    acceptTaskConversion(result)
    organization.acceptConversion(result)
    await Promise.all([refresh(), organization.refresh()])
  }, [acceptTaskConversion, organization, refresh])
  const createPage = async () => {
    if (!pageTitle.trim() || pageSaving) return
    setPageSaving(true); setPageError('')
    try {
      const saved = await organization.createPage({ title: pageTitle, kind: pageKind })
      chooseSpace(saved.id); setNewPage(false); setPageTitle('')
    } catch (err) { setPageError(err instanceof Error ? err.message : 'Не вдалося створити сторінку.') }
    finally { setPageSaving(false) }
  }
  const selectedLabel = parseLocalDate(selected).toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' })

  return <div ref={rootRef} className={'planner-screen' + (composerOpen ? ' has-composer' : '')}>
    <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
      {browsing ? <div className="flex items-center gap-2"><Button variant="ghost" className="h-11 w-11 p-0" aria-label="Повернутися до календаря" onClick={() => setBrowsing(false)}><ArrowLeft size={21} /></Button><h1 className="font-display text-xl font-bold text-text">Усі плани</h1></div>
        : <><button type="button" className="planner-space-title" {...press('space')} onClick={() => setMenu(open => !open)} aria-label="Сторінки особистого простору" aria-expanded={menu}><h1>{title}</h1><ChevronDown size={18} /></button>{space === 'plans' && <Button variant="ghost" className="h-11 w-11 p-0" aria-label="Пошук та всі плани" onClick={() => setBrowsing(true)}><Search size={21} /></Button>}</>}
    </div>
    {visibleError && <div role="alert" aria-live="polite" className="planner-error-toast">
      <p>{visibleError}</p>
      {plannerLoadError && <button type="button" onClick={() => loginRequired ? navigate('/auth') : void refresh()}>{loginRequired ? 'Увійти' : 'Повторити'}</button>}
    </div>}
    {space !== 'plans' ? <OrganizationView key={space} kind={space === 'notes' ? 'note' : space === 'goals' ? 'goal' : 'page'} pageId={page?.id} onOpenEntry={openRecord} onDeleteEntry={deleteRecord} onPageDeleted={() => chooseSpace('plans')} />
      : browsing ? <PlannerBrowse now={now} onOpen={openTask} onToggle={toggle} onUndatedChange={setBrowseUndated} onQuickActions={setQuickTask} onDelete={deleteTask} onPriorityChange={changePriority} /> : <>
        <PlannerCalendar month={month} today={today} selected={selected} tasks={calendarTasks} busy={busy} onSelect={selectDay} onMove={calendarMove} expanded={expanded} onExpandedChange={setExpanded} />
        <section className="planner-day-list" aria-labelledby="planner-day-title" aria-busy={loading}>
          <div className="flex min-h-14 items-center justify-between gap-2"><h2 id="planner-day-title" className="font-display text-sm font-semibold capitalize text-text">{selected === today ? 'Сьогодні' : selectedLabel}{selected === today && <span className="ml-2 font-normal text-text-muted">{parseLocalDate(selected).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}</span>}</h2></div>
          {loading && tasks.length === 0 ? <p role="status" className="planner-day-empty">Завантажую плани…</p>
            : dayTasks.length === 0 ? <p className="planner-day-empty">{selected === today ? 'На сьогодні планів немає.' : 'На цей день планів немає.'}</p>
              : <PlanList tasks={dayTasks.slice(0, visibleCount)} now={now} busy={busy} onOpen={openTask} onToggle={toggle} onQuickActions={setQuickTask} onDelete={deleteTask} onPriorityChange={changePriority} />}
          {dayTasks.length > visibleCount && <Button variant="ghost" className="mt-2 min-h-11 w-full" onClick={() => setVisibleCount(count => count + 60)}>Показати ще</Button>}
          {datedNotes.length > 0 && <section className="mt-5" aria-label="Нотатки вибраного дня"><h3 className="mb-2 text-xs font-semibold text-text-muted">Нотатки</h3>{datedNotes.map(entry => <OrganizationEntryRow key={entry.id} entry={entry} onOpen={openRecord} onDeleteEntry={deleteRecord} expanded={note?.id === entry.id} />)}</section>}
        </section>
      </>}
    {!composerOpen && <Button className="planner-add" aria-label="Додати запис" disabled={space === 'plans' && (loading || !!error)} onClick={() => { setEditor(null); setSelection({ kind: 'create' }) }}><Plus size={28} strokeWidth={1.8} /></Button>}
    <PlannerComposer open={composerOpen} mode={selectedPlan || note ? 'edit' : 'create'} plan={selectedPlan} entry={note} recordBusy={organization.busy} onUpdateRecord={organization.updateEntry} onSaveGoalItems={organization.saveGoalItems} onDeleteRecord={deleteRecord} onConvert={convertEntry} initialDate={browsing && browseUndated ? null : selected} initialType={space === 'goals' || page?.kind === 'goals' ? 'goal' : space === 'notes' || page ? 'note' : 'plan'} availableTags={availableTags} onClose={() => setSelection(null)} onDelete={deleteTask} onCreateRecord={createRecord} />
    <PlannerSheet open={!!recordDelete} title={recordDelete?.kind === 'goal' ? 'Видалити ціль?' : 'Видалити нотатку?'} onClose={() => { if (!deletingRecordRef.current) setRecordDelete(null) }} footer={<button type="button" className="planner-solid-button !bg-danger" disabled={deletingRecord || organization.busy} onClick={async () => {
      if (!recordDelete || deletingRecordRef.current || organization.busy) return
      deletingRecordRef.current = true; setDeletingRecord(true); setActionError(null)
      try { await organization.deleteEntry(recordDelete.id, recordDelete.updated_at); deletedDraft.clear(); setRecordDelete(null) }
      catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Не вдалося видалити запис.') }
      finally { deletingRecordRef.current = false; setDeletingRecord(false) }
    }}>{deletingRecord ? 'Видалення…' : 'Видалити'}</button>}><p className="text-sm break-words">{recordDelete?.title}</p>{actionError && <p role="alert" className="text-sm text-danger">{actionError}</p>}</PlannerSheet>
    <TaskEditor open={editor?.action === 'delete'} occurrence={editor?.action === 'delete' ? editor.occurrence : null} initialAction="delete" onClose={() => setEditor(null)} />
    <TaskQuickActions task={quickTask} onClose={() => setQuickTask(null)} onMove={move} />
    <PlannerSheet open={menu} onClose={() => setMenu(false)} title="Особистий простір" scrimCloseOnClick>
      <div className="planner-space-menu">
        {[{ id: 'plans', title: 'Плани' }, { id: 'notes', title: 'Нотатки' }, { id: 'goals', title: 'Цілі' }, ...organization.pages].map(item => <button type="button" key={item.id} aria-current={space === item.id ? 'page' : undefined} onClick={() => chooseSpace(item.id)}>{item.title}</button>)}
        <button type="button" onClick={() => { setMenu(false); setNewPage(true) }}><FilePlus2 size={17} />Нова сторінка</button>
      </div>
    </PlannerSheet>
    <PlannerSheet open={newPage} onClose={() => { if (!pageSaving) setNewPage(false) }} title="Нова сторінка">
      <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void createPage() }}>
        <Input aria-label="Назва сторінки" placeholder="Наприклад, Цілі 2027" maxLength={100} value={pageTitle} onChange={event => setPageTitle(event.target.value)} autoFocus />
        <ChoicePicker value={pageKind} onChange={setPageKind} label="Вміст сторінки" options={[{ value: 'mixed', label: 'Нотатки й цілі' }, { value: 'notes', label: 'Нотатки' }, { value: 'goals', label: 'Цілі' }]} />
        {pageError && <p role="alert" className="text-sm text-danger">{pageError}</p>}
        <Button type="submit" className="min-h-11" disabled={pageSaving || !pageTitle.trim()}>{pageSaving ? 'Зберігаємо…' : 'Створити сторінку'}</Button>
      </form>
    </PlannerSheet>
  </div>
}
