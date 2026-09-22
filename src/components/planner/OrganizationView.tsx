import { memo, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, FileText, MoreHorizontal, Search, SlidersHorizontal, Target, Trash2, Undo2, X } from 'lucide-react'
import { useOrganization } from '../../context/OrganizationContext'
import { useTaskSwipe } from '../../hooks/useTaskSwipe'
import { usePlannerWorkspaceState } from '../../hooks/usePlannerWorkspace'
import { parseLocalDate } from '../../lib/planner'
import { goalProgress, type GoalData, type OrganizationEntry, type OrganizationPage } from '../../types/organization'
import { Button, Input } from '../ui'
import { PlannerSheet } from './PlannerSheet'
import { ChoicePicker } from './PlannerPickers'
import { CompactPlannerMenu } from './CompactPlannerMenu'
import './organization.css'
import './organization-swipes.css'

type Sort = 'updated' | 'created' | 'title'
type EntryFilter = 'all' | 'note' | 'goal'
const SORTS: { value: Sort; label: string }[] = [
  { value: 'updated', label: 'За зміною' }, { value: 'created', label: 'За створенням' }, { value: 'title', label: 'За назвою' },
]

function dateLabel(date: string) {
  return new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }).format(parseLocalDate(date))
}

function periodLabel(goal?: GoalData) {
  if (!goal || goal.period === 'none') return 'Без терміну'
  if (goal.period === 'year') return `На ${goal.year} рік`
  return goal.startDate && goal.endDate ? `${dateLabel(goal.startDate)} — ${dateLabel(goal.endDate)}` : 'Свій період'
}

export const OrganizationEntryRow = memo(function OrganizationEntryRow({ entry, onOpen, onDeleteEntry, expanded = false }: { entry: OrganizationEntry; onOpen: (entry: OrganizationEntry) => void; onDeleteEntry?: (entry: OrganizationEntry) => void; expanded?: boolean }) {
  const { busy, toggleGoalCompletion } = useOrganization()
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const progress = goalProgress(entry)
  const completed = entry.kind === 'goal' && entry.data.goal?.completed === true
  const Icon = entry.kind === 'goal' ? Target : FileText
  const toggle = async () => {
    if (busy || pending.current) return
    pending.current = true; setError(null)
    try { await toggleGoalCompletion(entry.id, entry.updated_at) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не вдалося змінити стан цілі.') }
    finally { pending.current = false }
  }
  const canDelete = entry.kind === 'note' && !!onDeleteEntry
  const swipe = useTaskSwipe({ enabled: !busy && (entry.kind === 'goal' || canDelete), hasLeftActions: canDelete, hasRightAction: entry.kind === 'goal', resetKey: `${entry.id}:${entry.kind}:${completed}`, onToggle: toggle, onSwipeLeft: canDelete ? () => onDeleteEntry?.(entry) : undefined })
  const remove = () => { swipe.closeActions(); onDeleteEntry?.(entry) }
  return <div ref={swipe.ref} {...swipe.bind} className={`organization-row planner-timeline-task planner-action-row${completed ? ' organization-row-completed is-completed' : ''}${swipe.isRevealed ? ' has-revealed-actions' : ''}`} aria-busy={busy || undefined}
    onKeyDown={event => { if (event.key === 'Escape' && swipe.isRevealed) { event.preventDefault(); event.stopPropagation(); swipe.closeActions() } }}>
    {entry.kind === 'goal' && <div className="planner-swipe-action" aria-hidden="true">{completed ? <Undo2 size={21} /> : <Check size={21} />}</div>}
    {canDelete && <div className="planner-swipe-left-actions" aria-hidden={!swipe.isRevealed}>
      <button type="button" data-no-swipe tabIndex={swipe.isRevealed ? 0 : -1} disabled={busy} className="planner-swipe-delete" aria-label={`Видалити нотатку: ${entry.title}`} onClick={remove}><Trash2 size={18} /></button>
    </div>}
    <div className="organization-row-surface planner-timeline-surface">
    <button type="button" className="organization-row-open" aria-expanded={entry.kind === 'note' ? expanded : undefined} onClick={() => onOpen(entry)}>
    <span className="organization-row-icon"><Icon size={19} aria-hidden="true" /></span>
    <span className="organization-row-content">
      <span className="organization-row-title">{entry.title}</span>
      {entry.description && <span className="organization-row-excerpt">{entry.description}</span>}
      {entry.kind === 'goal' ? <span className="organization-row-meta"><span>{periodLabel(entry.data.goal)}</span>{progress.total > 0 && <span>{progress.completed}/{progress.total} · {progress.percent}%</span>}</span>
        : entry.date && <span className="organization-row-meta">{dateLabel(entry.date)}</span>}
      {entry.tags.length > 0 && <span className="organization-row-tags">{entry.tags.slice(0, 3).map(tag => <span key={tag}>#{tag}</span>)}{entry.tags.length > 3 && <span>+{entry.tags.length - 3}</span>}</span>}
      {entry.kind === 'goal' && progress.total > 0 && <span className="organization-progress" role="progressbar" aria-label="Поступ цілі" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ width: `${progress.percent}%` }} /></span>}
    </span>
    </button>
    {entry.kind === 'goal' && <button type="button" role="checkbox" data-no-swipe data-row-swipe-control aria-checked={completed} aria-label={`${completed ? 'Повернути в активні' : 'Виконати ціль'}: ${entry.title}`} className="planner-timeline-toggle" disabled={busy} onClick={() => { void toggle() }}><span className={`planner-timeline-check${completed ? ' is-checked' : ''}`}>{completed && <Check size={14} aria-hidden="true" />}</span></button>}
    {canDelete && <div className="planner-row-controls"><button type="button" data-no-swipe data-row-swipe-control className="planner-row-control planner-row-delete" disabled={busy} aria-label={`Видалити нотатку: ${entry.title}`} onClick={remove}><Trash2 size={17} /></button></div>}
    </div>
    {error && <p role="alert" className="organization-error organization-row-error">{error}</p>}
  </div>
})

/** Collections share the workspace composer; this view deliberately owns no +. */
export function OrganizationView({ kind, pageId, onPageDeleted, onOpenEntry, onDeleteEntry }: { kind: 'note' | 'goal' | 'page'; pageId?: string; onPageDeleted?: () => void; onOpenEntry: (entry: OrganizationEntry) => void; onDeleteEntry?: (entry: OrganizationEntry) => void }) {
  const { entries, pages, loading, error, refresh } = useOrganization()
  const viewKey = `collection:${kind === 'page' ? pageId : kind}`
  const [query, setQuery] = usePlannerWorkspaceState(`${viewKey}:query`, '')
  const [sort, setSort] = usePlannerWorkspaceState<Sort>(`${viewKey}:sort`, 'updated')
  const [tag, setTag] = usePlannerWorkspaceState(`${viewKey}:tag`, '')
  const [filter, setFilter] = usePlannerWorkspaceState<EntryFilter>(`${viewKey}:filter`, 'all')
  const [filtersOpen, setFiltersOpen] = usePlannerWorkspaceState(`${viewKey}:filters-open`, false)
  const [visibleCount, setVisibleCount] = usePlannerWorkspaceState(`${viewKey}:visible-count`, 50)
  const [pageSettings, setPageSettings] = useState(false)
  const sortAnchor = useRef<HTMLButtonElement>(null)
  const scoped = useMemo(() => entries.filter(entry => kind === 'page' ? entry.page_id === pageId : entry.kind === kind), [entries, kind, pageId])
  const tags = useMemo(() => [...new Set(scoped.flatMap(entry => entry.tags))].sort((a, b) => a.localeCompare(b, 'uk')), [scoped])
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('uk-UA')
    return scoped.filter(entry => (!tag || entry.tags.includes(tag)) && (filter === 'all' || entry.kind === filter)
      && (!needle || `${entry.title} ${entry.description} ${entry.tags.join(' ')}`.toLocaleLowerCase('uk-UA').includes(needle)))
      .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'uk') || a.id.localeCompare(b.id)
        : (sort === 'created' ? b.created_at.localeCompare(a.created_at) : b.updated_at.localeCompare(a.updated_at)) || a.id.localeCompare(b.id))
  }, [scoped, query, tag, filter, sort])
  const page = pages.find(item => item.id === pageId)
  const title = kind === 'note' ? 'Нотатки' : kind === 'goal' ? 'Цілі' : page?.title ?? 'Сторінка'
  const activeFilter = !!tag || filter !== 'all'
  return <section className="organization-view" aria-label={title}>
    <div className="organization-toolbar">
      <div className="organization-search">
        <Search size={17} aria-hidden="true" />
        <Input aria-label={`Пошук: ${title}`} placeholder="Знайти запис або мітку" value={query} onChange={event => { setQuery(event.target.value); setVisibleCount(50) }} />
        {query && <button type="button" className="planner-icon-button" aria-label="Очистити пошук" onClick={() => setQuery('')}><X size={17} /></button>}
      </div>
      <button ref={sortAnchor} type="button" className="planner-icon-button organization-filter-toggle" aria-label="Сортування та фільтри" aria-haspopup="dialog" aria-expanded={filtersOpen} data-active={activeFilter || undefined} onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={19} /></button>
      {kind === 'page' && page && <button type="button" className="planner-icon-button" aria-label="Налаштування сторінки" aria-haspopup="dialog" aria-expanded={pageSettings} onClick={() => setPageSettings(true)}><MoreHorizontal size={20} /></button>}
    </div>
    <CompactPlannerMenu open={filtersOpen} onClose={() => setFiltersOpen(false)} anchor={sortAnchor} title="Сортування та фільтри">
      {SORTS.map(option => <button key={option.value} type="button" aria-pressed={sort === option.value} onClick={() => { setSort(option.value); setVisibleCount(50); setFiltersOpen(false) }}>{option.label}{sort === option.value && <Check size={16} />}</button>)}
      {tags.length > 0 && <ChoicePicker value={tag} onChange={value => { setTag(value); setVisibleCount(50) }} label="Мітка" options={[{ value: '', label: 'Усі мітки' }, ...tags.map(value => ({ value, label: `#${value}` }))]} />}
      {kind === 'page' && page?.kind === 'mixed' && <ChoicePicker<EntryFilter> value={filter} onChange={value => { setFilter(value); setVisibleCount(50) }} label="Тип запису" options={[{ value: 'all', label: 'Усі записи' }, { value: 'note', label: 'Нотатки' }, { value: 'goal', label: 'Цілі' }]} />}
      {activeFilter && <button type="button" className="planner-plain-button" onClick={() => { setTag(''); setFilter('all') }}>Скинути фільтри</button>}
    </CompactPlannerMenu>
    {activeFilter && !filtersOpen && <button type="button" className="organization-active-filter" onClick={() => setFiltersOpen(true)}>Фільтр: {tag ? `#${tag}` : filter === 'note' ? 'Нотатки' : 'Цілі'}</button>}
    {error && <div className="organization-error" role="alert"><p>{error}</p><button type="button" className="planner-plain-button" onClick={() => { void refresh() }}>Повторити</button></div>}
    <div className="organization-list" aria-busy={loading}>
      {loading && !scoped.length ? <p className="organization-empty" role="status">Завантаження записів…</p>
        : results.length ? results.slice(0, visibleCount).map(entry => <OrganizationEntryRow key={entry.id} entry={entry} onOpen={onOpenEntry} onDeleteEntry={onDeleteEntry} />)
          : <div className="organization-empty">{query.trim() || activeFilter ? 'Нічого не знайдено. Спробуйте інші слова або мітки.'
            : kind === 'goal' ? 'До чого хочеться прийти? Додайте першу ціль через +.'
              : kind === 'note' ? 'Місце для думок та ідей. Додайте першу нотатку через +.'
                : 'Ця сторінка поки порожня. Додайте запис через +.'}</div>}
      {results.length > visibleCount && <Button type="button" variant="ghost" className="mt-3 min-h-11 w-full" onClick={() => setVisibleCount(count => count + 50)}>Показати ще ({results.length - visibleCount})</Button>}
    </div>
    {pageSettings && page && <OrganizationPageSettings key={page.id} page={page} onClose={() => setPageSettings(false)} onDeleted={() => { setPageSettings(false); onPageDeleted?.() }} />}
  </section>
}

function OrganizationPageSettings({ page, onClose, onDeleted }: { page: OrganizationPage; onClose: () => void; onDeleted: () => void }) {
  const { busy, updatePage, deletePage } = useOrganization()
  const [title, setTitle] = useState(page.title)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  // Keep the revision from opening this panel: background changes must not be
  // overwritten by a title the user started editing from an earlier revision.
  const versionRef = useRef(page.updated_at)
  const id = useId()
  const locked = busy || saving
  const close = () => { if (!savingRef.current && !busy) onClose() }
  const run = async (operation: () => Promise<void>) => {
    if (savingRef.current || busy) return
    savingRef.current = true; setSaving(true); setError(null)
    try { await operation() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не вдалося змінити сторінку.') }
    finally { savingRef.current = false; setSaving(false) }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => { await updatePage(page.id, { title }, versionRef.current); onClose() })
  }
  return <>
    <PlannerSheet open title="Налаштування сторінки" onClose={close} footer={<div className="organization-footer"><Button type="button" variant="ghost" disabled={locked} onClick={close}>Скасувати</Button><Button type="submit" form={`${id}-page`} disabled={locked || !title.trim()}>{saving ? 'Збереження…' : 'Зберегти'}</Button></div>}>
      <form id={`${id}-page`} className="organization-edit-form" onSubmit={submit} noValidate>
        <label htmlFor={`${id}-title`}>Назва сторінки<Input id={`${id}-title`} value={title} maxLength={100} disabled={locked} onChange={event => setTitle(event.target.value)} /></label>
        <p className="organization-hint">{page.kind === 'notes' ? 'Сторінка для нотаток.' : page.kind === 'goals' ? 'Сторінка для цілей.' : 'Сторінка для нотаток і цілей.'}</p>
        {error && <p role="alert" className="organization-error">{error}</p>}
      </form>
      <div className="organization-page-danger"><button type="button" disabled={locked} onClick={() => { setError(null); setConfirmDelete(true) }}><Trash2 size={17} />Видалити сторінку</button></div>
    </PlannerSheet>
    <PlannerSheet open={confirmDelete} title="Видалити сторінку?" onClose={() => { if (!locked) setConfirmDelete(false) }} footer={<div className="organization-footer"><Button type="button" variant="ghost" disabled={locked} onClick={() => setConfirmDelete(false)}>Залишити</Button><Button type="button" variant="danger" disabled={locked} onClick={() => { void run(async () => { await deletePage(page.id, versionRef.current); onDeleted() }) }}>{saving ? 'Видалення…' : 'Видалити'}</Button></div>}>
      <p className="organization-delete-title">{page.title}</p>
      <p className="organization-hint">Записи залишаться у розділах «Нотатки» та «Цілі». Буде видалена лише ця сторінка.</p>
      {error && <p role="alert" className="organization-error">{error}</p>}
    </PlannerSheet>
  </>
}
