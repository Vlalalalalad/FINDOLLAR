import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Filter, ChevronUp } from 'lucide-react'
import clsx from 'clsx'
import { useAccounts, useCategories, useTransactions } from '../hooks'
import { Button, Card, EmptyState, Input, Label, Modal, Select } from '../components/ui'
import { TransactionRow } from '../components/TransactionRow'
import { TransactionDetail } from '../components/TransactionDetail'
import { TransactionEditModal } from '../components/TransactionEditModal'
import { formatMoney } from '../lib/currency'
import { dateGroupLabel } from '../lib/datetime'
import { isDebtTransaction } from '../lib/transactions'
import { useTheme } from '../context/ThemeContext'
import type { Transaction, TransactionType } from '../types/database'

export function Transactions() {
  const { data: accounts, loading: accountsLoading } = useAccounts()
  const { data: categories, loading: categoriesLoading } = useCategories()
  const { data: transactions, loading: transactionsLoading, create, update } = useTransactions()
  const loading = accountsLoading || categoriesLoading || transactionsLoading
  const { hideBalances } = useTheme()

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [prefill, setPrefill] = useState<{ accountId?: string; type?: TransactionType }>({})
  const [filterType, setFilterType] = useState<'all' | TransactionType>('all')
  const [filterAccount, setFilterAccount] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filterModalOpen, setFilterModalOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [returnToDetailId, setReturnToDetailId] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [showScrollTop, setShowScrollTop] = useState(false)

  const detailTransaction = transactions.find(t => t.id === detailId) ?? null
  const filtersActive = filterType !== 'all' || filterAccount !== 'all' || Boolean(dateFrom) || Boolean(dateTo)

  // Кнопка "нагору" з'являється, тільки коли справді прокрутили вниз.
  useEffect(() => {
    const scrollContainer = document.querySelector<HTMLElement>('.app-main')
    if (!scrollContainer) return

    const onScroll = () => setShowScrollTop(scrollContainer.scrollTop > 400)
    scrollContainer.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => scrollContainer.removeEventListener('scroll', onScroll)
  }, [])

  // Кнопки "Поповнити" / "Переказати" / "Зняти" на картці рахунку ведуть
  // сюди з ?prefillAccount=...&prefillType=... — відкриваємо форму вже
  // заповненою потрібним рахунком і типом. "Подивитись всі операції" веде
  // з ?filterAccount=... — просто застосовує фільтр. А "Редагувати" з
  // деталей операції в картці рахунку — з ?editTransaction=... — відкриває
  // форму редагування тієї самої операції тут.
  useEffect(() => {
    const prefillAccount = searchParams.get('prefillAccount')
    const filterAccountParam = searchParams.get('filterAccount')
    const editTransactionId = searchParams.get('editTransaction')
    if ((!prefillAccount && !filterAccountParam && !editTransactionId) || accounts.length === 0) return

    if (prefillAccount) {
      const acc = accounts.find(a => a.id === prefillAccount)
      if (acc) {
        const prefillType = (searchParams.get('prefillType') as TransactionType | null) ?? 'expense'
        setEditing(null)
        setReturnToDetailId(null)
        setPrefill({ accountId: acc.id, type: prefillType })
        setModalOpen(true)
      }
    } else if (filterAccountParam) {
      setFilterAccount(filterAccountParam)
    } else if (editTransactionId) {
      const t = transactions.find(x => x.id === editTransactionId)
      if (t) {
        setReturnToDetailId(null)
        openEdit(t)
      }
    }
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, accounts, transactions])

  const filtered = useMemo(
    () =>
      transactions.filter(t => {
        if (filterType !== 'all' && (isDebtTransaction(t) || t.type !== filterType)) return false
        if (filterAccount !== 'all' && t.account_id !== filterAccount && t.transfer_to_account_id !== filterAccount) return false
        if (dateFrom && t.occurred_at < dateFrom) return false
        if (dateTo && t.occurred_at > `${dateTo}T23:59:59`) return false
        return true
      }),
    [transactions, filterType, filterAccount, dateFrom, dateTo]
  )

  const openEdit = (t: Transaction) => {
    setEditing(t)
    setPrefill({})
    setModalOpen(true)
  }

  const closeEditModal = () => {
    setModalOpen(false)
    if (returnToDetailId) {
      setDetailId(returnToDetailId)
      setReturnToDetailId(null)
    }
  }

  const saveTransaction = async (id: string | null, values: Record<string, unknown>) => {
    if (id) await update(id, values)
    else await create(values)
    closeEditModal()
  }

  const accountLabel = (id: string | null, nameSnapshot: string | null) => {
    const acc = accounts.find(a => a.id === id)
    if (acc) return <span>{acc.name}</span>
    return <span className="text-text-muted/70">{nameSnapshot ?? 'видалений актив'}</span>
  }
  const categoryName = (id: string | null) => categories.find(c => c.id === id)?.name ?? ''

  // "Скасувати" не створює новий рядок — просто позначає цей самий
  // прапорцем is_cancelled. Баланс і статистика рахують операції
  // наскрізним фільтром "!is_cancelled" (useCapital, Dashboard,
  // Statistics), тож ефект зникає сам собою: було +500 — перестало
  // додаватись до балансу, було -500 — перестало віднімати. Сам запис
  // лишається в історії видимим, просто приглушеним і з позначкою.
  // Підтвердження запитує сам TransactionDetail — сюди долітає вже готове рішення.
  const handleReverse = async (t: Transaction) => {
    await update(t.id, { is_cancelled: true })
    setDetailId(null)
  }

  // Групування по днях, як у банківських виписках. Денну суму рахуємо
  // тільки якщо всі операції дня в одній валюті (інакше цифра була б
  // безглуздою мішаниною валют) — перекази і скасовані в неї не йдуть.
  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>()
    const order: string[] = []
    filtered.forEach(t => {
      const d = new Date(t.occurred_at)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (!map.has(key)) {
        map.set(key, [])
        order.push(key)
      }
      map.get(key)!.push(t)
    })
    return order.map(key => {
      const items = map.get(key)!
      const singleCurrency = new Set(items.map(t => t.currency)).size === 1
      const net = singleCurrency
        ? items.reduce((sum, t) => {
            if (t.is_cancelled || t.type === 'transfer' || isDebtTransaction(t)) return sum
            return sum + (t.type === 'income' ? t.amount : -t.amount)
          }, 0)
        : null
      return { key, date: new Date(items[0].occurred_at), items, net, currency: items[0].currency }
    })
  }, [filtered])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-text">Історія операцій</h1>
        {accounts.length > 0 && (
          <button
            type="button"
            onClick={() => setFilterModalOpen(true)}
            className="relative rounded-lg border border-border p-2.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
            aria-label="Фільтри"
          >
            <Filter size={18} />
            {filtersActive && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-14 rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          title="Спочатку додай актив"
          description="Операції прив'язані до активів — створи хоча б один на сторінці «Активи»."
        />
      ) : (
        <>
          {filtered.length === 0 ? (
            <EmptyState
              title="Немає операцій"
              description={filtersActive ? 'Під ці фільтри нічого не підійшло.' : 'Тут з’являться твої операції.'}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map(g => (
                <div key={g.key}>
                  <div className="mb-1.5 flex items-baseline justify-between px-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                      {dateGroupLabel(g.date)}
                    </span>
                    {g.net !== null && (
                      <span
                        className={clsx(
                          'font-mono text-xs font-semibold tabular-nums',
                          g.net > 0 ? 'text-success' : g.net < 0 ? 'text-danger' : 'text-text-muted'
                        )}
                      >
                        {hideBalances ? '••••' : (g.net > 0 ? '+' : '') + formatMoney(g.net, g.currency)}
                      </span>
                    )}
                  </div>
                  <Card className="p-0">
                    <div className="flex flex-col divide-y divide-dashed divide-border">
                      {g.items.map(t => (
                        <TransactionRow
                          key={t.id}
                          t={t}
                          accountLabel={accountLabel}
                          categoryName={categoryName}
                          hideBalances={hideBalances}
                          onClick={() => setDetailId(t.id)}
                        />
                      ))}
                    </div>
                  </Card>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <TransactionEditModal
        open={modalOpen}
        onClose={closeEditModal}
        transaction={editing}
        prefillAccountId={prefill.accountId}
        prefillType={prefill.type}
        accounts={accounts}
        categories={categories}
        onSave={saveTransaction}
      />

      <Modal open={filterModalOpen} onClose={() => setFilterModalOpen(false)} title="Фільтри">
        <div className="flex flex-col gap-4">
          <div>
            <Label>Тип</Label>
            <Select value={filterType} onChange={e => setFilterType(e.target.value as 'all' | TransactionType)}>
              <option value="all">Усі типи</option>
              <option value="income">Дохід</option>
              <option value="expense">Витрати</option>
              <option value="transfer">Перекази</option>
            </Select>
          </div>
          <div>
            <Label>Актив</Label>
            <Select value={filterAccount} onChange={e => setFilterAccount(e.target.value)}>
              <option value="all">Усі активи</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Період</Label>
            <div className="grid grid-cols-2 gap-3">
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => setFilterModalOpen(false)} className="flex-1">
              Готово
            </Button>
            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setFilterType('all')
                  setFilterAccount('all')
                  setDateFrom('')
                  setDateTo('')
                }}
                className="motion-soft-enter rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-2"
              >
                Скинути
              </button>
            )}
          </div>
        </div>
      </Modal>

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
          openEdit(t)
        }}
        onReverse={handleReverse}
      />

      <button
        onClick={event => {
          event.currentTarget.blur()
          document.querySelector<HTMLElement>('.app-main')?.scrollTo({ top: 0, behavior: 'smooth' })
        }}
        aria-hidden={!showScrollTop}
        tabIndex={showScrollTop ? 0 : -1}
        className={clsx(
          'fixed bottom-24 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border-2 border-text bg-surface text-text shadow-md transition-[opacity,transform] duration-200 ease-out hover:opacity-80',
          showScrollTop ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'
        )}
        aria-label="Нагору"
      >
        <ChevronUp size={22} strokeWidth={2.5} />
      </button>
    </div>
  )
}
