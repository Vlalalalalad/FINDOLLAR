import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, AlertTriangle } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import clsx from 'clsx'
import { useCapital } from '../hooks/useCapital'
import { useCategories } from '../hooks'
import { Card, Input, Label } from '../components/ui'
import { convertToBase, formatAmount, formatMoney } from '../lib/currency'
import { startOfWeek } from '../lib/datetime'
import { categoryPresentation, isDebtTransaction } from '../lib/transactions'
import { useTheme } from '../context/ThemeContext'

type Period = 'thisWeek' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'allTime' | 'custom'
type Kind = 'expense' | 'income'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'thisWeek', label: 'Цей тиждень' },
  { value: 'thisMonth', label: 'Цей місяць' },
  { value: 'lastMonth', label: 'Минулий місяць' },
  { value: 'thisYear', label: 'Цей рік' },
  { value: 'allTime', label: 'Весь час' },
  { value: 'custom', label: 'Свій період' },
]

function periodRange(
  period: Period,
  custom: { start: string; end: string }
): { start: Date | null; end: Date | null } {
  const now = new Date()
  if (period === 'thisWeek') return { start: startOfWeek(now), end: null }
  if (period === 'thisMonth') return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null }
  if (period === 'lastMonth') {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(now.getFullYear(), now.getMonth(), 1),
    }
  }
  if (period === 'thisYear') return { start: new Date(now.getFullYear(), 0, 1), end: null }
  if (period === 'custom') {
    const start = custom.start ? new Date(custom.start + 'T00:00:00') : null
    const end = custom.end ? new Date(new Date(custom.end + 'T00:00:00').getTime() + 24 * 60 * 60 * 1000) : null
    return { start, end }
  }
  return { start: null, end: null }
}

function todayInputValue(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function Statistics() {
  const navigate = useNavigate()
  const { transactions, ratesMap, baseCurrency, loading, ratesLoading } = useCapital()
  const { data: categories, loading: categoriesLoading } = useCategories()
  const { hideBalances } = useTheme()

  const [period, setPeriod] = useState<Period>('thisMonth')
  const [kind, setKind] = useState<Kind>('expense')
  const [customStart, setCustomStart] = useState(todayInputValue())
  const [customEnd, setCustomEnd] = useState(todayInputValue())

  const mask = (value: string) => (hideBalances ? '••••' : value)

  const { items, total, missingRate, count } = useMemo(() => {
    const { start, end } = periodRange(period, { start: customStart, end: customEnd })
    const filtered = transactions.filter(t => {
      if (t.type !== kind || t.is_cancelled || isDebtTransaction(t)) return false
      const d = new Date(t.occurred_at)
      if (start && d < start) return false
      if (end && d >= end) return false
      return true
    })

    const map = new Map<string, { name: string; color: string; amount: number }>()
    let missing = false
    filtered.forEach(t => {
      const converted = convertToBase(t.amount, t.currency, baseCurrency, ratesMap)
      if (converted === null) {
        missing = true
        return
      }
      const category = categoryPresentation(categories, kind, t.category_id)
      const existing = map.get(category.key)
      if (existing) existing.amount += converted
      else map.set(category.key, { name: category.name, color: category.color, amount: converted })
    })

    const sorted = Array.from(map.values()).sort((a, b) => b.amount - a.amount)
    return {
      items: sorted,
      total: sorted.reduce((sum, i) => sum + i.amount, 0),
      missingRate: missing,
      count: filtered.length,
    }
  }, [transactions, categories, period, kind, baseCurrency, ratesMap, customStart, customEnd])

  if (loading || ratesLoading || categoriesLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-5 w-20 animate-pulse rounded bg-surface-2" />
        <div className="h-8 w-40 animate-pulse rounded bg-surface-2" />
        <div className="h-10 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-56 w-56 animate-pulse self-center rounded-full bg-surface-2" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <button
        onClick={() => navigate('/')}
        className="flex w-fit items-center gap-1 text-sm font-medium text-text-muted transition-colors hover:text-text"
      >
        <ChevronLeft size={16} /> Огляд
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-text">Статистика</h1>
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-1">
          {(['expense', 'income'] as Kind[]).map(k => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={clsx(
                'rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors',
                kind === k ? 'bg-surface text-primary shadow-sm' : 'text-text-muted hover:text-text'
              )}
            >
              {k === 'expense' ? 'Витрати' : 'Дохід'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface-2 p-1">
        {PERIODS.map(p => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPeriod(p.value)}
            className={clsx(
              'shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
              period === p.value ? 'bg-surface text-primary shadow-sm' : 'text-text-muted hover:text-text'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {period === 'custom' && (
        <div className="motion-soft-enter grid grid-cols-2 gap-3">
          <div>
            <Label>Від</Label>
            <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} max={customEnd} />
          </div>
          <div>
            <Label>До</Label>
            <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} min={customStart} />
          </div>
        </div>
      )}

      {missingRate && (
        <p className="motion-soft-enter flex items-center gap-1.5 text-xs text-warning">
          <AlertTriangle size={13} className="shrink-0" />
          Частину операцій не вдалося перевести в {baseCurrency} — немає курсу. Дані нижче неповні.
        </p>
      )}

      <Card>
        {items.length === 0 ? (
          <p className="py-12 text-center text-sm text-text-muted">
            {kind === 'expense' ? 'Витрат' : 'Доходу'} за цей період ще немає.
          </p>
        ) : (
          <>
            <div className="relative mx-auto h-56 w-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={items}
                    dataKey="amount"
                    nameKey="name"
                    innerRadius={72}
                    outerRadius={104}
                    paddingAngle={items.length > 1 ? 2 : 0}
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                  >
                    {items.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => formatMoney(v, baseCurrency)}
                    contentStyle={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 10,
                      fontFamily: 'IBM Plex Mono, monospace',
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-xl font-bold tabular-nums text-text">
                  {mask((kind === 'expense' ? '-' : '') + formatAmount(total))}
                </span>
                <span className="text-xs text-text-muted">{baseCurrency}</span>
                <span className="mt-0.5 text-xs text-text-muted">{count} оп.</span>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3">
              {items.map(item => (
                <div key={item.name} className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="truncate text-sm text-text">{item.name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <span className="text-xs text-text-muted">
                      {total > 0 ? Math.round((item.amount / total) * 100) : 0}%
                    </span>
                    <span className="font-mono text-sm font-semibold tabular-nums text-text">
                      {mask((kind === 'expense' ? '-' : '') + formatMoney(item.amount, baseCurrency))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
