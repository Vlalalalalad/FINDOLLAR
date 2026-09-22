import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { History, Pencil, Share2, Trash2, ChevronDown, ChevronUp, ArrowUpCircle, ArrowDownCircle } from 'lucide-react'
import { useDebts, useDebtEntries } from '../hooks'
import { useCapital } from '../hooks/useCapital'
import { Badge, Button, Card, Input, Label, Modal, Select, Textarea, useConfirm } from '../components/ui'
import { CURRENCIES, convertToBase, formatAmount, formatMoney } from '../lib/currency'
import { shareDebtCard } from '../lib/debtCard'
import { dateGroupLabel } from '../lib/datetime'
import { DEBT_TRANSACTION_TAG } from '../lib/transactions'
import { useTheme } from '../context/ThemeContext'
import clsx from 'clsx'
import type { Debt, DebtDirection, DebtEntry, DebtEntryKind, DebtStatus } from '../types/database'

const STATUS_LABELS: Record<DebtStatus, string> = {
  open: 'Відкрито',
  partially_paid: 'Частково погашено',
  paid: 'Погашено',
  overdue: 'Прострочено',
  cancelled: 'Скасовано',
}

// Кожен статус — свій, добре відрізнюваний колір.
const STATUS_COLORS: Record<DebtStatus, string> = {
  open: '#2E93C9',
  partially_paid: '#C98A1D',
  paid: '#0E8F6E',
  overdue: '#B5432E',
  cancelled: '#6B6A63',
}

const EMPTY_MESSAGES: Record<DebtDirection, string> = {
  owed_to_me: 'Тобі ніхто не винен',
  i_owe: 'Ти нікому не винен',
}

// Порядок у списку: активні (відкриті/прострочені) → частково погашені →
// повністю закриті (погашені/скасовані). Закритий борг завжди нижче.
const statusRank = (s: DebtStatus) => (s === 'paid' || s === 'cancelled' ? 2 : s === 'partially_paid' ? 1 : 0)

const dateInputValue = (date = new Date()) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const dateInputToIso = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return new Date().toISOString()
  // Полудень у локальному часовому поясі не дає даті «переїхати» на сусідній
  // день під час збереження timestamptz для автоматично створеної операції.
  return new Date(year, month - 1, day, 12, 0, 0).toISOString()
}

// Значення для datetime-local потрібно формувати в локальному часі, інакше
// браузер покаже запис зі зміщенням на часовий пояс користувача.
const dateTimeInputValue = (value: string) => {
  // Дата виникнення зберігається без часу (YYYY-MM-DD). Парсимо її як
  // локальний полудень, щоб у часових поясах із від'ємним UTC не показати
  // попередній день у datetime-local.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const dateTimeInputToIso = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

const emptyForm = {
  direction: 'owed_to_me' as DebtDirection,
  counterparty: '',
  amount: '',
  currency: 'UAH',
  occurred_on: dateInputValue(),
  due_date: '',
  status: 'open' as DebtStatus,
  notes: '',
  // Рахунок, якого торкнулись гроші при виникненні боргу (надходження
  // мені при "я винен", видача з рахунку при "мені винні"). Порожній —
  // руху грошей не було (людина просто заплатила за мене).
  account_id: '',
}

// Чи списує ця зміна боргу гроші З рахунку (а не зараховує на нього):
// повертаю свій борг — списання; мені повертають — зарахування;
// "додати до боргу" — навпаки.
const entryDecreasesAccount = (kind: DebtEntryKind, direction: DebtDirection) =>
  kind === 'repayment' ? direction === 'i_owe' : direction === 'owed_to_me'

interface DebtHistoryItem {
  id: string
  kind: DebtEntryKind
  amount: number
  description: string | null
  occurred_at: string
  isInitial: boolean
}

// Історія боргу для показу: справжні записи змін + перший віртуальний
// рядок "Створено борг". Початкова сума живе в самому боргу (debts.amount)
// і рахується в залишок окремо від записів — якби зберігати її ще й
// записом у debt_entries, вона врахувалась б у залишок двічі. Тож рядок
// тільки для показу, з датою виникнення боргу. Нотатка створення (d.notes)
// показується саме тут — як опис цього першого запису, цілком нарівні з
// описами решти змін.
function debtHistoryItems(d: Debt, entries: DebtEntry[]): DebtHistoryItem[] {
  const items: DebtHistoryItem[] = entries.map(e => ({
    id: e.id,
    kind: e.kind,
    amount: e.amount,
    description: e.description,
    occurred_at: e.occurred_at,
    isInitial: false,
  }))
  items.push({
    id: `initial-${d.id}`,
    kind: 'increase',
    amount: d.amount,
    description: d.notes,
    occurred_at: d.occurred_on ?? d.created_at,
    isInitial: true,
  })
  return items.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
}

// Групування вже відсортованого списку в блоки по днях — як в операціях.
function groupByDay<T extends { occurred_at: string }>(items: T[]): { key: string; date: Date; items: T[] }[] {
  const groups: { key: string; date: Date; items: T[] }[] = []
  items.forEach(item => {
    const date = new Date(item.occurred_at)
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(item)
    else groups.push({ key, date, items: [item] })
  })
  return groups
}

export function Debts() {
  const { data: debts, loading, create, update, remove } = useDebts()
  const { data: debtEntries, loading: entriesLoading, create: createEntry, update: updateEntry, remove: removeEntry } = useDebtEntries()
  const {
    accounts,
    transactions,
    createTransaction,
    updateTransaction,
    baseCurrency,
    ratesMap,
    loading: capitalLoading,
    ratesLoading,
  } = useCapital()
  const { theme, hideBalances } = useTheme()
  const { confirm, ConfirmDialog } = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Debt | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [returnToDetailId, setReturnToDetailId] = useState<string | null>(null)
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [entryMode, setEntryMode] = useState<DebtEntryKind | null>(null)
  const [entryAmount, setEntryAmount] = useState('')
  const [entryDescription, setEntryDescription] = useState('')
  const [entryAccountId, setEntryAccountId] = useState('')
  const [entryEditing, setEntryEditing] = useState<DebtHistoryItem | null>(null)
  const [entryEditForm, setEntryEditForm] = useState({ occurred_at: '', description: '' })
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [sharing, setSharing] = useState(false)
  const sharingRef = useRef(false)
  const detailContentRef = useRef<HTMLDivElement>(null)

  const detailDebt = debts.find(d => d.id === detailId) ?? null

  // Рахунки для прив'язки — лише у валюті боргу, щоб сума не губилась
  // на конвертації. Немає таких рахунків — селекта просто не буде.
  const accountsInCurrency = (currency: string) => accounts.filter(a => a.currency === currency)

  // Залишок боргу — не окреме поле, а сума: початкова amount + всі
  // "додати" − всі "погашення". Той самий принцип, що й баланс рахунку:
  // рахуємо наскрізно з історії, а не тримаємо окреме число, яке треба
  // не забути оновити в кожному місці.
  const entriesFor = (debtId: string) =>
    debtEntries.filter(e => e.debt_id === debtId).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))

  // Історія відкритого в модалці боргу: справжні записи змін + перший
  // рядок «Створено борг» з початковою сумою (він завжди є, тож список
  // ніколи не порожній).
  const detailHistoryAll = detailDebt ? debtHistoryItems(detailDebt, entriesFor(detailDebt.id)) : []
  const detailHistoryVisible = showAllHistory ? detailHistoryAll : detailHistoryAll.slice(0, 3)

  const remaining = (d: Debt) =>
    debtEntries
      .filter(e => e.debt_id === d.id)
      .reduce((sum, e) => sum + (e.kind === 'increase' ? e.amount : -e.amount), d.amount)

  // Для показу — завжди невід'ємний. Погашення точно в нуль часом дає
  // "-0.00" чи крихітний від'ємний залишок через похибку floating point;
  // затиснувши в 0 тут, а не в самій remaining(), рахунок історії й
  // статусу лишається математично точним, а на екрані просто ніколи не
  // буде ні "-0,00", ні зайвого мінуса попереду.
  const displayRemaining = (d: Debt) => Math.max(0, remaining(d))

  // Записи саме поточного циклу боргу: проходимо історію від найстарішого
  // запису, і як тільки залишок десь по дорозі впав у 0 (борг був повністю
  // погашений) — усе ДО цієї миті лишається позаду. Якщо потім борг ожив
  // новим "додати", його нотатки не тягнуть за собою нотатки старого,
  // уже закритого боргу. Нотатки самого боргу народились разом із його
  // створенням, тобто належать першому циклу — коли цикл уже змінився,
  // вони, як і старі описи змін, більше не показуються.
  const currentCycle = (d: Debt) => {
    const chronological = debtEntries.filter(e => e.debt_id === d.id).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    let running = d.amount
    let cycleStart = 0
    chronological.forEach((e, i) => {
      running += e.kind === 'increase' ? e.amount : -e.amount
      if (running <= 0) cycleStart = i + 1
    })
    return { entries: chronological.slice(cycleStart), includesInitial: cycleStart === 0 }
  }

  // Нотатки поточного циклу (створення + описи змін) в одному прев'ю на
  // головній — щоб не доводилось відкривати історію, аби побачити, чому
  // саме борг зріс чи зменшився. Тільки текст, без суми — сума й так
  // видно поряд у самій картці боргу. Початкова нотатка бере участь у
  // спільному сортуванні за датою нарівні з рештою.
  const combinedNotes = (d: Debt) => {
    const { entries, includesInitial } = currentCycle(d)
    const all: { text: string; date: string }[] = []
    if (includesInitial && d.notes) all.push({ text: d.notes, date: d.occurred_on ?? d.created_at })
    entries.forEach(e => {
      if (e.description) all.push({ text: e.description, date: e.occurred_at })
    })
    all.sort((a, b) => b.date.localeCompare(a.date))
    return all.map(n => n.text).join('\n')
  }

  const openCreate = (direction: DebtDirection) => {
    setEditing(null)
    setForm({ ...emptyForm, direction })
    setModalOpen(true)
  }

  const openEdit = (d: Debt) => {
    setEditing(d)
    setForm({
      direction: d.direction,
      counterparty: d.counterparty,
      amount: String(d.amount),
      currency: d.currency,
      occurred_on: d.occurred_on ?? dateInputValue(new Date(d.created_at)),
      due_date: d.due_date ?? '',
      status: d.status,
      notes: d.notes ?? '',
      account_id: '',
    })
    setModalOpen(true)
  }

  const closeEditModal = () => {
    setModalOpen(false)
    if (returnToDetailId) {
      setDetailId(returnToDetailId)
      setReturnToDetailId(null)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const amount = Number(form.amount)
    const values = {
      direction: form.direction,
      counterparty: form.counterparty,
      amount,
      currency: form.currency,
      occurred_on: form.occurred_on || dateInputValue(),
      due_date: form.due_date || null,
      status: form.status,
      notes: form.notes || null,
    }
    if (editing) {
      await update(editing.id, values)
    } else {
      const debt = await create(values)
      // Обраний рахунок — гроші справді рухались: борг "я винен" означає,
      // що гроші надійшли мені (баланс зросте), "мені винні" — що я їх
      // передав (баланс впаде). Операція з debt_id одразу потрапляє в
      // історію рахунку, окремо нічого створювати не треба.
      if (form.account_id) {
        await createTransaction({
          type: form.direction === 'i_owe' ? 'income' : 'expense',
          account_id: form.account_id,
          transfer_to_account_id: null,
          category_id: null,
          debt_id: debt.id,
          amount,
          currency: form.currency,
          description: `Додано до боргу: ${form.counterparty}`,
          mood: null,
          tags: [DEBT_TRANSACTION_TAG],
          occurred_at: dateInputToIso(form.occurred_on || dateInputValue()),
        })
      }
    }
    closeEditModal()
  }

  // Видалення — тільки з форми редагування і тільки з підтвердженням:
  // випадковий клік нічого не знищує. Операції рахунків, народжені з
  // цього боргу, в історії лишаються (debt_id після видалення боргу БД
  // просто обнуляє) — реальний рух грошей з історії не зникає.
  const handleDelete = async () => {
    if (!editing) return
    const ok = await confirm('Ви впевнені, що хочете видалити цей борг? Разом із ним зникне історія його змін.')
    if (!ok) return
    const id = editing.id
    setReturnToDetailId(null)
    closeEditModal()
    // Older rows may predate the durable system tag. Attach it before the
    // FK clears debt_id so they remain distinguishable from real income and
    // expenses after this debt is deleted.
    const untaggedTransactions = transactions.filter(
      transaction => transaction.debt_id === id && !transaction.tags?.includes(DEBT_TRANSACTION_TAG)
    )
    await Promise.all(
      untaggedTransactions.map(transaction =>
        updateTransaction(transaction.id, {
          tags: [...(transaction.tags ?? []), DEBT_TRANSACTION_TAG],
        })
      )
    )
    await remove(id)
  }

  const openDetail = (d: Debt) => {
    setDetailId(d.id)
    setShowAllHistory(false)
    setShowScrollTop(false)
    setEntryMode(null)
    setEntryAmount('')
    setEntryDescription('')
    setEntryAccountId('')
    // Стан «Надіслати» належить конкретному боргу: відкриваючи інший,
    // завжди починаємо з чистої активної кнопки, щоб застряглий стан
    // ніколи не переносився на новий борг.
    sharingRef.current = false
    setSharing(false)
  }

  // Статус виводимо з арифметики, яку вже знаємо в цю мить — не чекаємо,
  // поки хук перечитає debt_entries з бази (це відбудеться, але вже
  // після цього виклику, і на статус спиратись зарано).
  const handleAddEntry = async (d: Debt) => {
    const amt = Number(entryAmount)
    if (!entryMode || !amt || amt <= 0) return

    await createEntry({
      debt_id: d.id,
      kind: entryMode,
      amount: amt,
      description: entryDescription || null,
      occurred_at: new Date().toISOString(),
    })

    // Обраний рахунок — гроші справді рухались: створюємо операцію, і
    // баланс рахунку з історією оновлюються самі. Напрямок залежить від
    // типу зміни й напрямку боргу (повертаю свій борг — списання, мені
    // повертають — зарахування, "додати" — навпаки).
    if (entryAccountId) {
      await createTransaction({
        type: entryDecreasesAccount(entryMode, d.direction) ? 'expense' : 'income',
        account_id: entryAccountId,
        transfer_to_account_id: null,
        category_id: null,
        debt_id: d.id,
        amount: amt,
        currency: d.currency,
        description: entryMode === 'repayment' ? `Погашення боргу: ${d.counterparty}` : `Додано до боргу: ${d.counterparty}`,
        mood: null,
        tags: [DEBT_TRANSACTION_TAG],
        occurred_at: new Date().toISOString(),
      })
    }

    const newRemaining = remaining(d) + (entryMode === 'increase' ? amt : -amt)
    let newStatus: DebtStatus = d.status
    if (newRemaining <= 0) newStatus = 'paid'
    else if (entryMode === 'repayment') newStatus = 'partially_paid'
    else if (entryMode === 'increase' && d.status === 'paid') newStatus = 'open'
    if (newStatus !== d.status) await update(d.id, { status: newStatus })

    setEntryMode(null)
    setEntryAmount('')
    setEntryDescription('')
    setEntryAccountId('')
  }

  const openEntryEdit = (item: DebtHistoryItem) => {
    if (!detailDebt) return
    // Усі рядки, включно з початковим «Створено борг», відкривають один
    // редактор історії. Початковий рядок зберігається в debts, тому під час
    // збереження його дата/опис записуються в сам борг.
    setEntryEditing(item)
    setEntryEditForm({
      occurred_at: item.isInitial ? item.occurred_at.slice(0, 10) : dateTimeInputValue(item.occurred_at),
      description: item.description ?? '',
    })
  }

  const closeEntryEdit = () => {
    setEntryEditing(null)
    setEntryEditForm({ occurred_at: '', description: '' })
  }

  const statusAfterEntryChange = (d: Debt, nextRemaining: number): DebtStatus => {
    if (nextRemaining <= 0) return 'paid'
    if (d.status === 'cancelled' || d.status === 'overdue') return d.status
    return nextRemaining < d.amount ? 'partially_paid' : 'open'
  }

  const handleEntryEditSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!entryEditing || !detailDebt || !entryEditForm.occurred_at) return
    const description = entryEditForm.description.trim() || null
    if (entryEditing.isInitial) {
      // Для початкової точки дата виникнення — date-only. Беремо саме
      // локальну частину datetime-local, щоб часовий пояс не змінив день.
      await update(detailDebt.id, {
        occurred_on: entryEditForm.occurred_at.split('T')[0],
        notes: description,
      })
    } else {
      await updateEntry(entryEditing.id, {
        occurred_at: dateTimeInputToIso(entryEditForm.occurred_at),
        description,
      })
    }
    closeEntryEdit()
  }

  const handleEntryDelete = async () => {
    if (!entryEditing || entryEditing.isInitial || !detailDebt) return
    const ok = await confirm('Видалити цей запис з історії боргу? Дію неможливо скасувати.')
    if (!ok) return
    const currentRemaining = remaining(detailDebt)
    const nextRemaining = currentRemaining - (entryEditing.kind === 'increase' ? entryEditing.amount : -entryEditing.amount)
    await removeEntry(entryEditing.id)
    const nextStatus = statusAfterEntryChange(detailDebt, nextRemaining)
    if (nextStatus !== detailDebt.status) await update(detailDebt.id, { status: nextStatus })
    closeEntryEdit()
  }

  // Ряд значень саме поточного циклу — для графіка на картці боргу.
  // Графік завжди починається з окремої реальної стартової точки 0 грн,
  // потім показує початкову суму боргу та залишок після кожної зміни.
  // Старі цикли сюди не потрапляють ніколи.
  const cycleSeries = (d: Debt): number[] => {
    const { entries, includesInitial } = currentCycle(d)
    const points: number[] = [0]
    let running = 0
    if (includesInitial) {
      running = d.amount
      points.push(running)
    }
    entries.forEach(e => {
      running += e.kind === 'increase' ? e.amount : -e.amount
      points.push(Math.max(0, running))
    })
    return points
  }

  // Час кожної точки графіка: окремо стартовий 0 грн, початкова сума
  // в момент виникнення боргу та всі реальні зміни за їхніми timestamp.
  const cycleSeriesDates = (d: Debt): string[] => {
    const { entries, includesInitial } = currentCycle(d)
    const start = includesInitial ? d.occurred_on ?? d.created_at : entries[0]?.occurred_at ?? d.occurred_on ?? d.created_at
    const entryDates = entries.map(e => e.occurred_at)
    return includesInitial ? [start, start, ...entryDates] : [start, ...entryDates]
  }

  // Дата першої точки тієї самої поточної серії, яку показуємо на картці.
  // Якщо борг ожив після повного погашення, стартом є перше нове проведення,
  // а не дата створення старого циклу.
  const cycleStartDate = (d: Debt): string => {
    const { entries, includesInitial } = currentCycle(d)
    return includesInitial ? d.occurred_on ?? d.created_at : entries[0]?.occurred_at ?? d.occurred_on ?? d.created_at
  }

  // «Надіслати» малює окрему картку боргу (не скріншот сторінки) і
  // віддає її в системне меню поширення; де такого меню нема (звичайний
  // ПК-браузер) — зберігає файл. Картка будується з живих даних цього
  // боргу станом на зараз.
  const handleShareCard = async (d: Debt) => {
    if (sharingRef.current) return
    sharingRef.current = true
    setSharing(true)
    try {
      await shareDebtCard(
        {
          debt: d,
          remaining: displayRemaining(d),
          series: cycleSeries(d),
          seriesDates: cycleSeriesDates(d),
          startDate: cycleStartDate(d),
          tag: { label: STATUS_LABELS[d.status], color: STATUS_COLORS[d.status] },
        },
        theme
      )
    } finally {
      sharingRef.current = false
      setSharing(false)
    }
  }

  // Підсумок по напрямку, сконвертований в базову валюту — борги можуть
  // бути в різних валютах, тож просто скласти суми "як є" не вийде.
  const totalFor = (direction: DebtDirection) => {
    let total = 0
    let missing = false
    debts
      .filter(d => d.direction === direction && d.status !== 'paid' && d.status !== 'cancelled')
      .forEach(d => {
        const converted = convertToBase(displayRemaining(d), d.currency, baseCurrency, ratesMap)
        if (converted === null) missing = true
        else total += converted
      })
    return { total, missing }
  }

  const mask = (value: string) => (hideBalances ? '••••' : value)

  const renderList = (direction: DebtDirection, title: string) => {
    // Активні зверху, частково погашені далі, закриті — в самому низу.
    // Сортування стабільне, тож усередині кожної групи лишається
    // наявний порядок "новіші зверху". Рахунок боргу змінюється —
    // борг сам пересідає на потрібне місце.
    const items = debts
      .filter(d => d.direction === direction)
      .slice()
      .sort((a, b) => statusRank(a.status) - statusRank(b.status))
    const { total, missing } = totalFor(direction)
    // "Мені винні" — по суті актив, показуємо як є. "Я винен" — це
    // зобов'язання, зі знаком "-", так само як витрати на Огляді.
    const sign = direction === 'i_owe' ? '-' : ''

    return (
      <Card>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display font-semibold text-text">{title}</h2>
          <Button variant="secondary" onClick={() => openCreate(direction)}>
            + Додати
          </Button>
        </div>

        {items.length > 0 && (
          <div className="mb-3 flex items-baseline gap-1.5 border-b border-dashed border-border pb-3">
            <span className="text-xs text-text-muted">Загалом:</span>
            <span
              className={clsx(
                'font-mono text-sm font-bold tabular-nums',
                direction === 'i_owe' ? 'text-danger' : 'text-success'
              )}
            >
              {mask(sign + formatAmount(total) + ' ' + baseCurrency)}
            </span>
            {missing && <span className="text-xs text-warning">(неповно — немає курсу для якоїсь валюти)</span>}
          </div>
        )}

        {items.length === 0 && <p className="py-6 text-center text-sm text-text-muted">{EMPTY_MESSAGES[direction]}</p>}

        <div className="flex flex-col divide-y divide-dashed divide-border">
          {items.map(d => (
            <SwipeableDebtRow
              key={d.id}
              onOpenHistory={() => openDetail(d)}
              onEdit={() => {
                setReturnToDetailId(null)
                openEdit(d)
              }}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text">{d.counterparty}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge color={STATUS_COLORS[d.status]}>{STATUS_LABELS[d.status]}</Badge>
                      {d.due_date && (
                        <span className="text-xs text-text-muted">до {new Date(d.due_date).toLocaleDateString('uk-UA')}</span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-text">
                    {mask((displayRemaining(d) === 0 ? '' : sign) + formatMoney(displayRemaining(d), d.currency))}
                  </span>
                </div>
                {combinedNotes(d) && <NotesPreview text={combinedNotes(d)} />}
              </div>
            </SwipeableDebtRow>
          ))}
        </div>
      </Card>
    )
  }

  if (loading || entriesLoading || capitalLoading || ratesLoading) return <DebtsSkeleton />

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold text-text">Борги</h1>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {renderList('owed_to_me', 'Мені винні')}
        {renderList('i_owe', 'Я винен')}
      </div>

      <Modal open={modalOpen} onClose={closeEditModal} title={editing ? 'Редагувати борг' : 'Новий борг'}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <Label>Хто / кому</Label>
            <Input
              required
              value={form.counterparty}
              onChange={e => setForm(f => ({ ...f, counterparty: e.target.value }))}
              placeholder="Ім'я людини"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Сума</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                required
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <Label>Валюта</Label>
              <Select
                value={form.currency}
                onChange={e =>
                  setForm(f => ({
                    ...f,
                    currency: e.target.value,
                    // рахунки фільтруються за валютою боргу — як тільки
                    // валюта змінилась, старий вибір міг стати чужою валютою
                    account_id: accountsInCurrency(e.target.value).some(a => a.id === f.account_id) ? f.account_id : '',
                  }))
                }
              >
                {CURRENCIES.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label>Дата виникнення боргу</Label>
            <Input
              type="date"
              required
              max={dateInputValue()}
              value={form.occurred_on}
              onChange={e => setForm(f => ({ ...f, occurred_on: e.target.value }))}
            />
          </div>
          {!editing && accountsInCurrency(form.currency).length > 0 && (
            <div>
              <Label>Актив</Label>
              <Select value={form.account_id} onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}>
                <option value="">Без активу</option>
                {accountsInCurrency(form.currency).map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <p className="mt-1.5 text-xs text-text-muted">
                {form.direction === 'i_owe'
                  ? 'Вибери актив, якщо гроші справді надійшли тобі — його баланс збільшиться.'
                  : 'Вибери актив, якщо ти справді передав гроші — його баланс зменшиться.'}
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Термін</Label>
              <Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div>
              <Label>Статус</Label>
              <Select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as DebtStatus }))}>
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label>Нотатки</Label>
            <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-3">
            {editing && (
              <Button type="button" variant="danger" className="flex-1" onClick={handleDelete}>
                <Trash2 size={16} /> Видалити
              </Button>
            )}
            <Button type="submit" className="flex-1">
              {editing ? 'Зберегти' : 'Створити'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(entryEditing)}
        onClose={closeEntryEdit}
        stackLevel="top"
        title={
          entryEditing?.isInitial
            ? 'Редагувати виникнення боргу'
            : entryEditing?.kind === 'increase'
              ? 'Редагувати додавання'
              : 'Редагувати погашення'
        }
      >
        {entryEditing && (
          <form onSubmit={handleEntryEditSubmit} className="flex flex-col gap-4">
            <div>
              <Label>{entryEditing.isInitial ? 'Дата виникнення боргу' : 'Дата і час операції'}</Label>
              <Input
                type={entryEditing.isInitial ? 'date' : 'datetime-local'}
                required
                value={entryEditForm.occurred_at}
                onChange={e => setEntryEditForm(f => ({ ...f, occurred_at: e.target.value }))}
              />
            </div>
            <div>
              <Label>Опис / нотатка</Label>
              <Input
                value={entryEditForm.description}
                onChange={e => setEntryEditForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Необов'язково"
              />
            </div>
            <div className="flex items-center gap-3">
              {!entryEditing.isInitial && (
                <button
                  type="button"
                  onClick={handleEntryDelete}
                  aria-label="Видалити запис"
                  className="rounded-lg p-2 text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 size={17} />
                </button>
              )}
              <Button type="submit" className="flex-1">
                Зберегти
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(detailDebt)}
        onClose={() => setDetailId(null)}
        title="Історія боргу"
        contentRef={detailContentRef}
        onContentScroll={e => setShowScrollTop(e.currentTarget.scrollTop > 300)}
        footer={
          detailDebt && (
            <button
              type="button"
              onClick={() => handleShareCard(detailDebt)}
              disabled={sharing}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
            >
              <Share2 size={15} /> {sharing ? 'Готую картку…' : 'Надіслати'}
            </button>
          )
        }
      >
        {detailDebt && (
          <div className="relative flex flex-col gap-5">
            <div className="text-center">
              <div className="text-sm text-text-muted">{detailDebt.counterparty}</div>
              <div className="mt-1 font-mono text-3xl font-bold tabular-nums text-text">
                {mask(formatMoney(displayRemaining(detailDebt), detailDebt.currency))}
              </div>
              <div className="mt-1.5 flex items-center justify-center gap-1.5">
                <Badge color={STATUS_COLORS[detailDebt.status]}>{STATUS_LABELS[detailDebt.status]}</Badge>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEntryMode(m => (m === 'increase' ? null : 'increase'))}
                className={clsx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                  entryMode === 'increase' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-muted hover:bg-surface-2'
                )}
              >
                <ArrowUpCircle size={15} /> Додати
              </button>
              <button
                type="button"
                onClick={() => setEntryMode(m => (m === 'repayment' ? null : 'repayment'))}
                className={clsx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                  entryMode === 'repayment' ? 'border-success bg-success/10 text-success' : 'border-border text-text-muted hover:bg-surface-2'
                )}
              >
                <ArrowDownCircle size={15} /> Погашення
              </button>
            </div>

            {entryMode && (
              <div className="motion-soft-enter flex flex-col gap-3 rounded-lg border border-border p-3">
                <div>
                  <Label>Сума</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    autoFocus
                    value={entryAmount}
                    onChange={e => setEntryAmount(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Опис</Label>
                  <Input value={entryDescription} onChange={e => setEntryDescription(e.target.value)} placeholder="Необов'язково" />
                </div>
                {accountsInCurrency(detailDebt.currency).length > 0 && (
                  <div>
                    <Label>Актив</Label>
                    <Select value={entryAccountId} onChange={e => setEntryAccountId(e.target.value)}>
                      <option value="">Без активу</option>
                      {accountsInCurrency(detailDebt.currency).map(a => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </Select>
                    <p className="mt-1.5 text-xs text-text-muted">
                      {entryDecreasesAccount(entryMode, detailDebt.direction)
                        ? 'Сума спишеться з активу.'
                        : 'Сума зарахується на актив.'}
                    </p>
                  </div>
                )}
                <Button type="button" onClick={() => handleAddEntry(detailDebt)}>
                  {entryMode === 'increase' ? 'Додати до боргу' : 'Записати погашення'}
                </Button>
              </div>
            )}

            <div>
              <div className="mb-2 text-xs font-medium text-text-muted">Історія змін</div>
              <div className="flex flex-col gap-3">
                {groupByDay(detailHistoryVisible).map(g => (
                  <div key={g.key}>
                    <div className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                      {dateGroupLabel(g.date)}
                    </div>
                    <div className="flex flex-col divide-y divide-dashed divide-border overflow-hidden rounded-xl border border-border">
                      {g.items.map(entry => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => openEntryEdit(entry)}
                          className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                          aria-description="Редагувати запис"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            {entry.kind === 'increase' ? (
                              <ArrowUpCircle size={16} className="shrink-0 text-danger" />
                            ) : (
                              <ArrowDownCircle size={16} className="shrink-0 text-success" />
                            )}
                            <span className="truncate text-sm text-text">
                              {entry.description ||
                                (entry.isInitial ? 'Створено борг' : entry.kind === 'increase' ? 'Додано до боргу' : 'Погашення')}
                            </span>
                          </div>
                          <span
                            className={clsx(
                              'shrink-0 font-mono text-sm font-semibold tabular-nums',
                              entry.kind === 'increase' ? 'text-danger' : 'text-success'
                            )}
                          >
                            {mask((entry.kind === 'increase' ? '+' : '-') + formatMoney(entry.amount, detailDebt.currency))}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {!showAllHistory && detailHistoryAll.length > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAllHistory(true)}
                  className="mt-2 w-full rounded-lg py-1.5 text-center text-xs font-medium text-text-muted hover:text-text"
                >
                  Показати всю історію ({detailHistoryAll.length})
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {ConfirmDialog}

      <button
        onClick={event => {
          event.currentTarget.blur()
          detailContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
        }}
        aria-hidden={!showScrollTop || !detailDebt}
        tabIndex={showScrollTop && detailDebt ? 0 : -1}
        className={clsx(
          'fixed bottom-24 right-4 z-[60] flex h-11 w-11 items-center justify-center rounded-full border-2 border-text bg-surface text-text shadow-md transition-[opacity,transform] duration-200 ease-out hover:opacity-80',
          showScrollTop && detailDebt ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'
        )}
        aria-label="Нагору"
      >
        <ChevronUp size={22} strokeWidth={2.5} />
      </button>
    </div>
  )
}

function DebtsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-8 w-28 animate-pulse rounded-lg bg-surface-2" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[1, 2].map(i => (
          <div key={i} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
            <div className="h-5 w-28 animate-pulse rounded bg-surface-2" />
            {[1, 2].map(j => (
              <div key={j} className="h-14 animate-pulse rounded-lg bg-surface-2" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function NotesPreview({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (ref.current) setOverflowing(ref.current.scrollHeight > ref.current.clientHeight + 1)
  }, [text])

  return (
    <div className="mt-1.5 flex items-start gap-1">
      <p
        ref={ref}
        className={clsx(
          'min-w-0 flex-1 whitespace-pre-wrap break-words text-xs text-text-muted',
          !expanded && 'line-clamp-2'
        )}
      >
        {text}
      </p>
      {overflowing && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            setExpanded(v => !v)
          }}
          className="mt-0.5 shrink-0 rounded p-0.5 text-text-muted hover:text-text"
        >
          <ChevronDown size={12} className={clsx('transition-transform', expanded && 'rotate-180')} />
        </button>
      )}
    </div>
  )
}

const LEFT_TRIGGER = 70 // px вліво — редагування боргу
const LEFT_MAX = 120 // межа перетягування вліво
const RIGHT_TRIGGER = 70 // px вправо — історія боргу
const RIGHT_MAX = 120 // межа перетягування вправо
const DRAG_COMMIT_THRESHOLD = 6 // px — менше цього це клік/тап, не свайп

// Жести рядка боргу, однакові на ПК і телефоні: свайп вправо — історія
// боргу, свайп вліво — редагування, клік/тап — нічого. Під час
// перетягування з-під рядка виглядає кольорова підказка з іконкою
// відповідної дії (її ширина = зсуву рядка); у спокої ширина 0, тобто
// нічого не рендериться й не стирчить.
function SwipeableDebtRow({
  children,
  onOpenHistory,
  onEdit,
}: {
  children: React.ReactNode
  onOpenHistory: () => void
  onEdit: () => void
}) {
  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const startXRef = useRef(0)
  const pointerDownXRef = useRef(0)
  const pointerIdRef = useRef<number | null>(null)
  const committedRef = useRef(false)

  const translate = isDragging ? dragX : 0
  const panelTransition = isDragging ? 'none' : 'width 0.2s ease-out'
  const leftShow = Math.max(0, translate) // підказка "історія" зліва
  const rightShow = Math.max(0, -translate) // підказка "редагування" справа
  const nearHistory = translate >= RIGHT_TRIGGER
  const nearEdit = translate <= -LEFT_TRIGGER

  // setPointerCapture і власне драг стартують не одразу на pointerdown, а
  // тільки коли зсув переважить DRAG_COMMIT_THRESHOLD. Причина: миша на
  // ПК (на відміну від пальця) — це завжди клік по чомусь усередині рядка
  // (по кнопці розгортання нотаток, наприклад), і якщо хапати курсор
  // одразу, той клік іноді не долітає до цілі. До порогу — це просто
  // клік; драг починається тільки від реального зсуву.
  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointerIdRef.current = e.pointerId
    committedRef.current = false
    pointerDownXRef.current = e.clientX
    startXRef.current = e.clientX
  }
  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return
    if (!committedRef.current) {
      if (Math.abs(e.clientX - pointerDownXRef.current) < DRAG_COMMIT_THRESHOLD) return
      committedRef.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      setIsDragging(true)
    }
    setDragX(Math.max(-LEFT_MAX, Math.min(RIGHT_MAX, e.clientX - startXRef.current)))
  }
  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return
    pointerIdRef.current = null
    if (!committedRef.current) return // клік/тап — нічого не робить
    setIsDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // курсор уже поза елементом — не критично
    }

    if (dragX >= RIGHT_TRIGGER) onOpenHistory()
    else if (dragX <= -LEFT_TRIGGER) onEdit()
    setDragX(0)
  }

  return (
    <div className="relative overflow-hidden">
      {/* "історія" — ширина = зсув вправо. У спокої 0px, тобто нічого не рендериться. */}
      <div
        className="absolute inset-y-0 left-0 flex items-center justify-center overflow-hidden bg-primary text-white"
        style={{ width: leftShow, transition: panelTransition }}
      >
        <History size={20} className={clsx('shrink-0 transition-transform', nearHistory && 'scale-125')} />
      </div>
      {/* "редагування" — ширина = зсув вліво. У спокої 0px, тобто нічого не рендериться. */}
      <div
        className="absolute inset-y-0 right-0 flex items-center justify-center overflow-hidden bg-primary text-white"
        style={{ width: rightShow, transition: panelTransition }}
      >
        <Pencil size={20} className={clsx('shrink-0 transition-transform', nearEdit && 'scale-125')} />
      </div>

      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          transform: `translateX(${translate}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-out',
          touchAction: 'pan-y',
        }}
        className="relative select-none bg-surface py-3"
      >
        {children}
      </div>
    </div>
  )
}
