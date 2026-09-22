import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  TrendingUp,
  TrendingDown,
  Coins,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Check,
  RefreshCw,
  Settings,
} from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import clsx from 'clsx'
import { useCapital } from '../hooks/useCapital'
import { useCategories } from '../hooks'
import { Card, Label, Modal } from '../components/ui'
import { AccountsSection } from '../components/AccountsSection'
import { TodayPlansWidget } from '../components/planner/TodayPlansWidget'
import { CURRENCIES, convertToBase, formatAmount, formatMoney } from '../lib/currency'
import { startOfWeek } from '../lib/datetime'
import { isDebtTransaction } from '../lib/transactions'
import { useTheme } from '../context/ThemeContext'
import { usePresence } from '../hooks/usePresence'
import type { Mood } from '../types/database'
import { useAuth } from '../context/AuthContext'
import { accountStorage } from '../lib/accountStorage'

type WidgetPeriod = 'week' | 'month'
type WidgetKind = 'expense' | 'income' | 'both'
interface WidgetConfig {
  period: WidgetPeriod
  kind: WidgetKind
  showRing: boolean
}
const DEFAULT_WIDGET_CONFIG: WidgetConfig = { period: 'month', kind: 'expense', showRing: true }
const WIDGET_CONFIG_KEY = 'findollar-dashboard-widget'

function loadWidgetConfig(storage: ReturnType<typeof accountStorage>): WidgetConfig {
  try {
    const stored = storage.getItem(WIDGET_CONFIG_KEY)
    if (stored) return { ...DEFAULT_WIDGET_CONFIG, ...JSON.parse(stored) }
  } catch {
    // некоректний JSON у сховищі — просто йдемо на дефолт
  }
  return DEFAULT_WIDGET_CONFIG
}

export function Dashboard() {
  const { user } = useAuth()
  const storage = useMemo(() => accountStorage(user!.id), [user?.id])
  const navigate = useNavigate()
  const {
    accounts,
    transactions,
    createTransaction,
    updateTransaction,
    createAccount,
    updateAccount,
    removeAccount,
    reorderAccounts,
    baseCurrency,
    setBaseCurrency,
    ratesMap,
    totalInBase,
    missingRates,
    monthChangePercent,
    accountBalances,
    loading,
    ratesLoading,
  } = useCapital()
  const { data: categories, loading: categoriesLoading } = useCategories()
  const { hideBalances } = useTheme()
  const [changingCurrency, setChangingCurrency] = useState(false)
  const [currencySwitchWarning, setCurrencySwitchWarning] = useState(false)
  const [widgetConfig, setWidgetConfig] = useState<WidgetConfig>(() => loadWidgetConfig(storage))
  const [widgetSettingsOpen, setWidgetSettingsOpen] = useState(false)

  useEffect(() => {
    storage.setItem(WIDGET_CONFIG_KEY, JSON.stringify(widgetConfig))
  }, [widgetConfig, storage])

  // Поки триває зміна валюти, показуємо заморожений (старий) знімок
  // усього блоку капіталу — суми, %, попереджень — приглушеним, замість
  // того щоб щось із цього ховати/показувати (що й смикало висоту
  // картки).
  const [frozen, setFrozen] = useState({ total: totalInBase, percent: monthChangePercent, missing: missingRates })
  useEffect(() => {
    if (!changingCurrency) setFrozen({ total: totalInBase, percent: monthChangePercent, missing: missingRates })
  }, [totalInBase, monthChangePercent, missingRates, changingCurrency])

  const displayTotal = changingCurrency ? frozen.total : totalInBase
  const displayPercent = changingCurrency ? frozen.percent : monthChangePercent
  const displayMissing = changingCurrency ? frozen.missing : missingRates

  const handleBaseCurrencyChange = async (c: string) => {
    if (c === baseCurrency) return
    setChangingCurrency(true)
    setCurrencySwitchWarning(false)
    try {
      const { ratesRefreshed } = await setBaseCurrency(c)
      if (!ratesRefreshed) setCurrencySwitchWarning(true)
    } finally {
      setChangingCurrency(false)
    }
  }

  const moodStats = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthExpenses = transactions.filter(
      t => t.type === 'expense' && !t.is_cancelled && !isDebtTransaction(t) && new Date(t.occurred_at) >= monthStart
    )
    const withMood = monthExpenses.filter(t => t.mood)
    if (withMood.length === 0) return null
    const pct = (mood: Mood) => Math.round((withMood.filter(t => t.mood === mood).length / withMood.length) * 100)
    return { regret: pct('regret'), neutral: pct('neutral'), great: pct('great') }
  }, [transactions])

  // Віджет статистики на Огляді — сам собі рахує дохід/витрати й міні-
  // кільце по категоріях за період і "вид", обрані в налаштуваннях
  // віджета (шестерня на картці), а не жорстко "цей місяць, витрати".
  const widget = useMemo(() => {
    const now = new Date()
    const start = widgetConfig.period === 'week' ? startOfWeek(now) : new Date(now.getFullYear(), now.getMonth(), 1)
    let income = 0
    let expense = 0
    const catMap = new Map<string, { name: string; color: string; amount: number }>()

    transactions.forEach(t => {
      if (t.is_cancelled || isDebtTransaction(t) || (t.type !== 'income' && t.type !== 'expense') || new Date(t.occurred_at) < start) return
      const converted = convertToBase(t.amount, t.currency, baseCurrency, ratesMap)
      if (converted === null) return
      if (t.type === 'income') income += converted
      else expense += converted

      if (t.type === widgetConfig.kind) {
        const cat = categories.find(c => c.id === t.category_id)
        const key = cat?.id ?? 'none'
        const existing = catMap.get(key)
        if (existing) existing.amount += converted
        else catMap.set(key, { name: cat?.name ?? 'Без категорії', color: cat?.color ?? '#6B6A63', amount: converted })
      }
    })

    return { income, expense, chart: Array.from(catMap.values()).sort((a, b) => b.amount - a.amount) }
  }, [transactions, categories, baseCurrency, ratesMap, widgetConfig.period, widgetConfig.kind])

  const mask = (value: string) => (hideBalances ? '••••' : value)
  const periodLabel = widgetConfig.period === 'week' ? 'тиждень' : 'місяць'
  // Кільце по категоріях має сенс лише для одного конкретного виду (не
  // можна змішати дохід і витрату в одній діаграмі) — тому для "обидва"
  // воно просто не показується, лишаються тільки цифри.
  const showRing = widgetConfig.showRing && widgetConfig.kind !== 'both' && widget.chart.length > 0

  if (loading || ratesLoading || categoriesLoading) return <DashboardSkeleton />

  return (
    <div className="flex flex-col gap-6">
      {accounts.length === 0 ? (
        <EmptyDashboard />
      ) : (
        <>
          <Card className="capital-card relative">
            <div className="mb-2 flex items-center gap-2 text-text-muted">
              <Coins size={16} />
              <span className="text-xs font-medium">Загальний капітал</span>
            </div>

            <div className="flex items-baseline gap-2">
              <span
                className={clsx(
                  'font-mono text-3xl font-bold tabular-nums text-text transition-opacity',
                  changingCurrency && 'opacity-40'
                )}
              >
                {mask(formatAmount(displayTotal))}
              </span>
              <CurrencyPicker value={baseCurrency} onChange={handleBaseCurrencyChange} busy={changingCurrency} />
            </div>

            {displayPercent !== null && (
              <p
                className={clsx(
                  'mt-1.5 flex items-center gap-1 text-sm font-medium transition-opacity',
                  displayPercent >= 0 ? 'text-success' : 'text-danger',
                  changingCurrency && 'opacity-40'
                )}
              >
                {displayPercent >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {displayPercent >= 0 ? '+' : ''}
                {displayPercent.toFixed(2)}% цього місяця
              </p>
            )}

            {displayMissing.length > 0 && (
              <p
                className={clsx(
                  'motion-soft-enter mt-3 flex flex-wrap items-center gap-1.5 text-xs text-warning transition-opacity',
                  changingCurrency && 'opacity-40'
                )}
              >
                <AlertTriangle size={13} className="shrink-0" />
                Без курсу для {displayMissing.join(', ')} — сума вище неповна.
                <Link to="/profile" className="underline decoration-dotted hover:text-text">
                  Додати курс у Профілі
                </Link>
              </p>
            )}

            {!changingCurrency && currencySwitchWarning && (
              <p className="motion-soft-enter mt-3 flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle size={13} className="shrink-0" />
                Не вдалося оновити курси для {baseCurrency} — сума вище може бути неточною, спробуй ще раз за
                хвилину.
              </p>
            )}
          </Card>

          <AccountsSection
            title="Активи"
            showAddButton={false}
            showHint={false}
            accounts={accounts}
            accountBalances={accountBalances}
            transactions={transactions}
            categories={categories}
            createTransaction={createTransaction}
            updateTransaction={updateTransaction}
            hideBalances={hideBalances}
            loading={loading}
            create={createAccount}
            update={updateAccount}
            remove={removeAccount}
            reorder={reorderAccounts}
          />

          <div
            onClick={() => navigate('/statistics')}
            className="w-full cursor-pointer rounded-xl border border-border bg-surface p-5 transition-colors hover:bg-surface-2"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display font-semibold text-text">Статистика</h2>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation()
                    setWidgetSettingsOpen(true)
                  }}
                  aria-label="Налаштувати віджет"
                  className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
                >
                  <Settings size={15} />
                </button>
                <ChevronRight size={16} className="text-text-muted" />
              </div>
            </div>

            <div className="flex items-center gap-4">
              {showRing && (
                <div className="h-16 w-16 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={widget.chart} dataKey="amount" innerRadius={20} outerRadius={32} stroke="none">
                        {widget.chart.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="min-w-0 flex-1">
                {widgetConfig.kind !== 'expense' && (
                  <div className="flex items-center justify-between py-1">
                    <span className="flex items-center gap-2 text-sm text-text-muted">
                      <TrendingUp size={16} className="text-success" /> Дохід за {periodLabel}
                    </span>
                    <span className="font-mono text-sm font-semibold tabular-nums text-success">
                      {mask(formatMoney(widget.income, baseCurrency))}
                    </span>
                  </div>
                )}
                {widgetConfig.kind !== 'income' && (
                  <div className="flex items-center justify-between py-1">
                    <span className="flex items-center gap-2 text-sm text-text-muted">
                      <TrendingDown size={16} className="text-danger" /> Витрати за {periodLabel}
                    </span>
                    <span className="font-mono text-sm font-semibold tabular-nums text-danger">
                      {mask('-' + formatMoney(widget.expense, baseCurrency))}
                    </span>
                  </div>
                )}
              </div>
            </div>
            {moodStats && (
              <div className="mt-4 flex flex-col gap-1.5 rounded-lg bg-surface-2 p-3 text-xs text-text-muted">
                <div className="flex items-center justify-between">
                  <span>🔴 імпульс</span>
                  <b className="font-mono text-text">{moodStats.regret}%</b>
                </div>
                <div className="flex items-center justify-between">
                  <span>🟡 необхідність</span>
                  <b className="font-mono text-text">{moodStats.neutral}%</b>
                </div>
                <div className="flex items-center justify-between">
                  <span>🟢 заслужено</span>
                  <b className="font-mono text-text">{moodStats.great}%</b>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <TodayPlansWidget />

      <Modal open={widgetSettingsOpen} onClose={() => setWidgetSettingsOpen(false)} title="Налаштування віджета">
        <div className="flex flex-col gap-5">
          <div>
            <Label>Період</Label>
            <SegmentedControl
              value={widgetConfig.period}
              onChange={v => setWidgetConfig(c => ({ ...c, period: v }))}
              options={[
                { value: 'week', label: 'Тиждень' },
                { value: 'month', label: 'Місяць' },
              ]}
            />
          </div>
          <div>
            <Label>Показувати</Label>
            <SegmentedControl
              value={widgetConfig.kind}
              onChange={v => setWidgetConfig(c => ({ ...c, kind: v }))}
              options={[
                { value: 'expense', label: 'Витрати' },
                { value: 'income', label: 'Дохід' },
                { value: 'both', label: 'Обидва' },
              ]}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={widgetConfig.showRing}
              onChange={e => setWidgetConfig(c => ({ ...c, showRing: e.target.checked }))}
              disabled={widgetConfig.kind === 'both'}
            />
            Показувати кільце по категоріях
            {widgetConfig.kind === 'both' && (
              <span className="text-xs text-text-muted">(недоступно для "обидва")</span>
            )}
          </label>
        </div>
      </Modal>
    </div>
  )
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface-2 p-1">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors',
            value === o.value ? 'bg-surface text-primary shadow-sm' : 'text-text-muted hover:text-text'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function CurrencyPicker({
  value,
  onChange,
  busy,
}: {
  value: string
  onChange: (currency: string) => void
  busy?: boolean
}) {
  const [open, setOpen] = useState(false)
  const menuPresent = usePresence(open, 140)

  return (
    <div className="relative">
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-sm font-bold text-text transition-colors hover:bg-border disabled:opacity-70"
      >
        {value}
        {busy ? (
          <RefreshCw size={13} className="animate-spin" />
        ) : (
          <ChevronDown size={13} className={clsx('transition-transform', open && 'rotate-180')} />
        )}
      </button>

      {menuPresent && (
        <>
          <div
            className={clsx('fixed inset-0 z-40', !open && 'pointer-events-none')}
            onClick={() => setOpen(false)}
          />
          <div
            data-state={open ? 'open' : 'closed'}
            className="motion-popover absolute left-0 top-full z-50 mt-1 max-h-64 w-28 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg"
          >
            {CURRENCIES.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c)
                  setOpen(false)
                }}
                className={clsx(
                  'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                  c === value ? 'bg-surface-2 font-semibold text-text' : 'text-text-muted hover:bg-surface-2 hover:text-text'
                )}
              >
                {c}
                {c === value && <Check size={14} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function EmptyDashboard() {
  return (
    <Card className="py-12 text-center text-sm text-text-muted">
      Додай перший актив на сторінці «Активи», щоб побачити огляд капіталу.
    </Card>
  )
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-32 animate-pulse rounded-xl bg-surface-2" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-surface-2" />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-xl bg-surface-2" />
    </div>
  )
}
