import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Pencil,
  Trash2,
  Lock,
  GripVertical,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  Banknote,
  CreditCard,
  Landmark,
  Bitcoin,
  Wallet as WalletIcon,
  CircleEllipsis,
} from 'lucide-react'
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import clsx from 'clsx'
import { Button, Card, EmptyState, Input, Label, Modal, Select, useConfirm } from './ui'
import { ColorPicker, COLOR_PRESETS } from './ColorPicker'
import { TransactionRow } from './TransactionRow'
import { TransactionDetail } from './TransactionDetail'
import { TransactionEditModal } from './TransactionEditModal'
import { CURRENCIES, formatMoney, isCrypto } from '../lib/currency'
import { transactionCategoryName } from '../lib/transactions'
import { usePresence } from '../hooks/usePresence'
import type { Account, AccountType, Category, Transaction } from '../types/database'

const TYPE_LABELS: Record<AccountType, string> = {
  cash: 'Готівка',
  card: 'Картка',
  bank: 'Банк',
  crypto: 'Криптобіржа',
  wallet: 'Гаманець',
  other: 'Інше',
}

const TYPE_ICONS: Record<AccountType, typeof Banknote> = {
  cash: Banknote,
  card: CreditCard,
  bank: Landmark,
  crypto: Bitcoin,
  wallet: WalletIcon,
  other: CircleEllipsis,
}

const emptyForm = {
  name: '',
  type: 'cash' as AccountType,
  currency: 'UAH',
  starting_balance: '0',
  card_number: '',
  is_locked: false,
  color: COLOR_PRESETS[0],
}

const RECENT_COUNT = 3

// The sortable item itself is transformed during drag. Keep that transform
// inside the real grid so it cannot create scrollable empty space beyond the
// list. The grid may still scroll normally when it is taller than the screen.
const restrictAccountDragToGrid: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => {
  if (!draggingNodeRect || !containerNodeRect) return transform
  const minX = containerNodeRect.left - draggingNodeRect.left
  const maxX = containerNodeRect.right - draggingNodeRect.right
  const minY = containerNodeRect.top - draggingNodeRect.top
  const maxY = containerNodeRect.bottom - draggingNodeRect.bottom
  return {
    ...transform,
    x: maxX < minX ? 0 : Math.max(minX, Math.min(maxX, transform.x)),
    y: maxY < minY ? 0 : Math.max(minY, Math.min(maxY, transform.y)),
  }
}

const ACCOUNT_DRAG_MODIFIERS = [restrictAccountDragToGrid]

// Компонент навмисно НЕ тягне дані сам — усе приходить пропсами від
// сторінки, яка його показує, щоб і Огляд, і Рахунки завжди бачили
// однакові, синхронні дані з одного джерела.
export function AccountsSection({
  title,
  showAddButton = true,
  showHint = true,
  accounts,
  accountBalances,
  transactions,
  categories,
  updateTransaction,
  createTransaction,
  hideBalances,
  loading,
  create,
  update,
  remove,
  reorder,
}: {
  title?: ReactNode
  showAddButton?: boolean
  showHint?: boolean
  accounts: Account[]
  accountBalances: Record<string, number>
  transactions: Transaction[]
  categories: Category[]
  updateTransaction: (id: string, values: Record<string, unknown>) => Promise<unknown>
  createTransaction: (values: Record<string, unknown>) => Promise<unknown>
  hideBalances: boolean
  loading: boolean
  create: (values: Record<string, unknown>) => Promise<unknown>
  update: (id: string, values: Record<string, unknown>) => Promise<unknown>
  remove: (id: string) => Promise<unknown>
  reorder: (orderedIds: string[]) => Promise<unknown>
}) {
  const navigate = useNavigate()
  const [detailId, setDetailId] = useState<string | null>(null)
  const [returnToDetailId, setReturnToDetailId] = useState<string | null>(null)
  const [txEditOpen, setTxEditOpen] = useState(false)
  const [txEditing, setTxEditing] = useState<Transaction | null>(null)
  const [txPrefill, setTxPrefill] = useState<{ accountId?: string; type?: 'income' | 'expense' | 'transfer' }>({})
  const closeTxEdit = () => {
    setTxEditOpen(false)
    if (returnToDetailId) {
      setDetailId(returnToDetailId)
      setReturnToDetailId(null)
    }
  }
  const detailTransaction = transactions.find(t => t.id === detailId) ?? null
  const categoryName = (id: string | null, type: Transaction['type']) => transactionCategoryName(categories, type, id)
  const accountLabel = (id: string | null, nameSnapshot: string | null) => {
    const acc = accounts.find(a => a.id === id)
    if (acc) return <span>{acc.name}</span>
    return <span className="text-text-muted/70">{nameSnapshot ?? 'видалений актив'}</span>
  }

  const [formModalOpen, setFormModalOpen] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [detailAccount, setDetailAccount] = useState<Account | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [copyToast, setCopyToast] = useState<string | null>(null)
  const copyToastPresent = usePresence(Boolean(copyToast), 140)
  const lastCopyToast = useRef('')
  if (copyToast) lastCopyToast.current = copyToast
  const copyToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { confirm, ConfirmDialog } = useConfirm()

  useEffect(() => {
    return () => {
      if (copyToastTimer.current !== null) clearTimeout(copyToastTimer.current)
    }
  }, [])

  // Delay 500мс — щоб коротке тапання картки надійно відкривало деталі,
  // а не приймалось за початок перетягування.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 10 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 6 } })
  )

  const [returnToAccountDetail, setReturnToAccountDetail] = useState<string | null>(null)

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setDetailAccount(null)
    setReturnToAccountDetail(null)
    setFormModalOpen(true)
  }

  const openEditFromDetail = (a: Account) => {
    openEdit(a)
    setReturnToAccountDetail(a.id)
  }

  const openEdit = (a: Account) => {
    setReturnToAccountDetail(null)
    setEditing(a)
    setForm({
      name: a.name,
      type: a.type,
      currency: a.currency,
      starting_balance: String(a.starting_balance),
      card_number: a.card_number ?? '',
      is_locked: a.is_locked,
      color: a.color,
    })
    setDetailAccount(null)
    setFormModalOpen(true)
  }

  const closeAccountFormModal = () => {
    setFormModalOpen(false)
    if (returnToAccountDetail) {
      const a = accounts.find(x => x.id === returnToAccountDetail)
      if (a) setDetailAccount(a)
      setReturnToAccountDetail(null)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const values = {
      name: form.name,
      type: form.type,
      currency: form.currency,
      starting_balance: Number(form.starting_balance),
      card_number: form.card_number.trim() || null,
      is_locked: form.is_locked,
      color: form.color,
    }
    if (editing) await update(editing.id, values)
    else await create(values)
    closeAccountFormModal()
  }

  // Видалення рахунку тепер справжнє (не архівування) — операції на
  // ньому лишаються в історії з тими самими назвами й сумами, тільки
  // приглушеним кольором (БД: account_id ON DELETE SET NULL, а назву
  // рахунку зберігаємо окремим знімком перед видаленням). Тому кнопку
  // свідомо переніс сюди, у форму редагування — щоб не тиснулась
  // випадково з екрана деталей, куди потрапляєш одним тапом по картці.
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const handleDelete = async () => {
    if (!editing) return
    const ok = await confirm(`Видалити актив «${editing.name}»? На операції в історії це не вплине.`)
    if (!ok) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await remove(editing.id)
      setFormModalOpen(false)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Не вдалося видалити актив. Спробуй ще раз.')
    } finally {
      setDeleting(false)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = accounts.findIndex(a => a.id === active.id)
    const newIndex = accounts.findIndex(a => a.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const newOrder = arrayMove(accounts, oldIndex, newIndex)
    reorder(newOrder.map(a => a.id))
  }

  const goToTransactions = (accountId: string, type: 'income' | 'expense' | 'transfer') => {
    setTxEditing(null)
    setReturnToDetailId(null)
    setTxPrefill({ accountId, type })
    setTxEditOpen(true)
  }

  const viewAllTransactions = (accountId: string) => {
    navigate(`/transactions?filterAccount=${accountId}`)
  }

  const accountTransactions = useMemo(() => {
    if (!detailAccount) return []
    return transactions
      .filter(t => t.account_id === detailAccount.id || t.transfer_to_account_id === detailAccount.id)
      .slice(0, RECENT_COUNT)
  }, [transactions, detailAccount])

  const copyCardNumber = async () => {
    const number = detailAccount?.card_number?.trim()
    if (!number) return

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(number)
      } else {
        const helper = document.createElement('textarea')
        helper.value = number
        helper.style.position = 'fixed'
        helper.style.opacity = '0'
        document.body.appendChild(helper)
        helper.focus()
        helper.select()
        const copied = document.execCommand('copy')
        helper.remove()
        if (!copied) return
      }
      setCopyToast('Номер картки скопійовано')
      if (copyToastTimer.current !== null) clearTimeout(copyToastTimer.current)
      copyToastTimer.current = setTimeout(() => {
        setCopyToast(null)
        copyToastTimer.current = null
      }, 2200)
    } catch {
      // Clipboard access can be denied by the browser; this hidden action is
      // intentionally silent in that case and never interrupts account use.
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        {title ? <h2 className="font-display text-2xl font-bold text-text">{title}</h2> : <span />}
        {showAddButton && (
          <Button onClick={openCreate}>
            <Plus size={16} /> Додати актив
          </Button>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-surface-2" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          title="Ще немає активів"
          description="Додай готівку, картку, банк або криптобіржу, щоб почати облік."
          action={
            <Button onClick={openCreate}>
              <Plus size={16} /> Додати актив
            </Button>
          }
        />
      ) : (
        <>
          {showHint && accounts.length > 1 && (
            <p className="flex items-center gap-1.5 text-xs text-text-muted">
              <GripVertical size={13} /> Затримай і перетягни картку, щоб змінити порядок. Тапни, щоб відкрити.
            </p>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={ACCOUNT_DRAG_MODIFIERS}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={accounts.map(a => a.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {accounts.map(a => (
                  <AccountCard
                    key={a.id}
                    account={a}
                    balance={accountBalances[a.id] ?? a.starting_balance}
                    hideBalances={hideBalances}
                    onOpen={() => setDetailAccount(a)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}

      {/* Деталі рахунку: баланс, швидкі дії, останні операції */}
      <Modal
        open={!!detailAccount}
        onClose={() => setDetailAccount(null)}
        title={detailAccount?.name ?? ''}
        onTitleLongPress={detailAccount?.card_number?.trim() ? copyCardNumber : undefined}
      >
        {detailAccount && (
          <div className="flex flex-col gap-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-mono text-3xl font-bold tabular-nums text-text">
                  {hideBalances
                    ? '••••'
                    : formatMoney(accountBalances[detailAccount.id] ?? detailAccount.starting_balance, detailAccount.currency, {
                        // Повна точність (4-8 знаків) саме тут, у деталях рахунку,
                        // і саме для крипти — гаманці/біржі, де це важливо. Картки
                        // й Огляд лишаються округленими, щоб не рябіло цифрами.
                        full: isCrypto(detailAccount.currency),
                      })}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
                  {TYPE_LABELS[detailAccount.type]}
                  {detailAccount.is_locked && (
                    <span className="inline-flex items-center gap-0.5">
                      <Lock size={10} /> заблоковано
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => openEditFromDetail(detailAccount)}
                aria-label="Редагувати актив"
                className="shrink-0 rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                <Pencil size={16} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => goToTransactions(detailAccount.id, 'income')}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-border py-3 text-xs font-medium text-text transition-colors hover:bg-surface-2"
              >
                <ArrowDownToLine size={18} className="text-success" />
                Поповнити
              </button>
              <button
                onClick={() => goToTransactions(detailAccount.id, 'transfer')}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-border py-3 text-xs font-medium text-text transition-colors hover:bg-surface-2"
              >
                <ArrowLeftRight size={18} className="text-text-muted" />
                Переказати
              </button>
              <button
                onClick={() => goToTransactions(detailAccount.id, 'expense')}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-border py-3 text-xs font-medium text-text transition-colors hover:bg-surface-2"
              >
                <ArrowUpFromLine size={18} className="text-danger" />
                Зняти
              </button>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-text-muted">Останні операції</div>
              {accountTransactions.length === 0 ? (
                <p className="text-sm text-text-muted">Для цього активу ще немає операцій.</p>
              ) : (
                <div className="flex flex-col divide-y divide-dashed divide-border overflow-hidden rounded-xl border border-border bg-surface">
                  {accountTransactions.map(t => (
                    <TransactionRow
                      key={t.id}
                      t={t}
                      accountLabel={accountLabel}
                      categoryName={categoryName}
                      hideBalances={hideBalances}
                      dateLabel={new Date(t.occurred_at).toLocaleDateString('uk-UA', { day: '2-digit', month: 'short' })}
                      onClick={() => setDetailId(t.id)}
                    />
                  ))}
                </div>
              )}
              <button
                onClick={() => viewAllTransactions(detailAccount.id)}
                className="mt-2 w-full rounded-lg border border-border py-2 text-xs font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                Подивитись всі операції
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Створення / редагування рахунку */}
      <Modal
        open={formModalOpen}
        onClose={closeAccountFormModal}
        title={editing ? 'Редагувати актив' : 'Новий актив'}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <Label>Назва</Label>
            <Input
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Напр. Monobank UAH"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Тип</Label>
              <Select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as AccountType }))}>
                {Object.entries(TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Валюта</Label>
              <Select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                {CURRENCIES.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label>Початковий баланс</Label>
            <Input
              type="number"
              step={isCrypto(form.currency) ? '0.00000001' : '0.01'}
              value={form.starting_balance}
              onChange={e => setForm(f => ({ ...f, starting_balance: e.target.value }))}
            />
          </div>
          <div>
            <Label>Номер картки / рахунку</Label>
            <Input
              type="text"
              value={form.card_number}
              onChange={e => setForm(f => ({ ...f, card_number: e.target.value }))}
              placeholder="Необов’язково"
              autoComplete="off"
            />
          </div>
          <div>
            <Label>Колір</Label>
            <ColorPicker value={form.color} onChange={color => setForm(f => ({ ...f, color }))} />
          </div>
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={form.is_locked}
              onChange={e => setForm(f => ({ ...f, is_locked: e.target.checked }))}
            />
            Невільні (заблоковані) кошти
          </label>
          <Button type="submit">{editing ? 'Зберегти' : 'Створити'}</Button>

          {editing && (
            <div className="mt-1 border-t border-dashed border-border pt-4">
              {deleteError && <p className="mb-2 text-sm text-danger">{deleteError}</p>}
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-60"
              >
                <Trash2 size={14} /> {deleting ? 'Видалення...' : 'Видалити актив'}
              </button>
            </div>
          )}
        </form>
      </Modal>
      {ConfirmDialog}

      {copyToastPresent && (
        <div className="pointer-events-none fixed inset-x-4 bottom-24 z-[80] flex justify-center">
          <div
            data-state={copyToast ? 'open' : 'closed'}
            className="motion-popover rounded-lg bg-surface-3 px-3 py-2 text-sm font-medium text-text shadow-lg"
          >
            {lastCopyToast.current}
          </div>
        </div>
      )}

      <TransactionDetail
        transaction={detailTransaction}
        accounts={accounts}
        categories={categories}
        allTransactions={transactions}
        hideBalances={hideBalances}
        onClose={() => setDetailId(null)}
        onEdit={t => {
          setDetailId(null)
          setReturnToDetailId(t.id)
          setTxEditing(t)
          setTxEditOpen(true)
        }}
        onReverse={async t => {
          await updateTransaction(t.id, { is_cancelled: true })
          setDetailId(null)
        }}
      />

      <TransactionEditModal
        open={txEditOpen}
        onClose={closeTxEdit}
        transaction={txEditing}
        prefillAccountId={txPrefill.accountId}
        prefillType={txPrefill.type}
        accounts={accounts}
        categories={categories}
        onSave={async (id, values) => {
          if (id) await updateTransaction(id, values)
          else await createTransaction(values)
          closeTxEdit()
        }}
      />
    </div>
  )
}

function AccountCard({
  account,
  balance,
  hideBalances,
  onOpen,
}: {
  account: Account
  balance: number
  hideBalances: boolean
  onOpen: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: account.id })
  const Icon = TYPE_ICONS[account.type]

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (!isDragging) onOpen()
      }}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        background: `linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.32) 100%), linear-gradient(135deg, ${account.color}, ${account.color}CC)`,
      }}
      className={clsx(
        'relative flex touch-pan-y select-none flex-col gap-4 overflow-hidden rounded-2xl p-4 text-white shadow-sm transition-[box-shadow,transform] active:scale-[0.98]',
        isDragging && 'z-10 shadow-xl'
      )}
    >
      <Icon size={76} strokeWidth={1.25} className="pointer-events-none absolute -right-3 -top-3 text-white/20" />

      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-white/85">
          <GripVertical size={12} className="text-white/50" />
          {TYPE_LABELS[account.type]}
        </span>
        {account.is_locked && <Lock size={13} className="text-white/80" />}
      </div>

      <div>
        <div className="font-mono text-xl font-bold tabular-nums">
          {hideBalances ? '••••' : formatMoney(balance, account.currency)}
        </div>
        <div className="mt-0.5 truncate text-sm text-white/85">{account.name}</div>
      </div>
    </div>
  )
}
