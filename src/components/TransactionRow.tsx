import clsx from 'clsx'
import type { ReactNode } from 'react'
import type { Mood, Transaction } from '../types/database'
import { formatMoney, isCrypto } from '../lib/currency'
import { isDebtTransaction } from '../lib/transactions'

const MOOD_EMOJI: Record<Mood, string> = { great: '😊', neutral: '😐', regret: '😔' }

// Один-єдиний варіант "як підписати операцію", спільний для всіх списків
// ("Операції", деталі рахунку, останні операції): операціям з боргів —
// завжди "Борги", для решти спершу назва категорії. Подробиці боргу
// ("Додано до боргу: Арто") живуть у нотатці; без категорії — стандартний
// тип, щоб підпис ніколи не був порожнім.
export function transactionTitle(
  t: Pick<Transaction, 'category_id' | 'type' | 'debt_id' | 'description' | 'tags'>,
  categoryName: (id: string | null) => string
): string {
  if (isDebtTransaction(t)) return 'Борги'
  const cat = categoryName(t.category_id)
  if (cat) return cat
  if (t.type === 'income') return 'Дохід'
  if (t.type === 'expense') return 'Витрата'
  return 'Переказ'
}

export function TransactionRow({
  t,
  categoryName,
  accountLabel,
  hideBalances,
  dateLabel,
  onClick,
}: {
  t: Transaction
  categoryName: (id: string | null) => string
  accountLabel: (id: string | null, nameSnapshot: string | null) => ReactNode
  hideBalances: boolean
  dateLabel?: string
  onClick?: () => void
}) {
  const title = transactionTitle(t, categoryName)

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') onClick()
            }
          : undefined
      }
      className={clsx(
        'flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left',
        onClick && 'cursor-pointer transition-colors hover:bg-surface-2',
        t.is_cancelled && 'opacity-60'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {t.mood && <span className="shrink-0">{MOOD_EMOJI[t.mood]}</span>}
          <span className="truncate text-sm font-medium text-text">{title}</span>
          {t.is_cancelled && (
            <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] leading-none text-text-muted">
              скасовано
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-text-muted">
          {accountLabel(t.account_id, t.account_name_snapshot)}
          {t.type === 'transfer' && <> → {accountLabel(t.transfer_to_account_id, t.transfer_to_account_name_snapshot)}</>}
          {dateLabel && <> · {dateLabel}</>}
        </div>
      </div>

      <span
        className={clsx(
          'shrink-0 font-mono text-sm font-semibold tabular-nums',
          t.is_cancelled
            ? 'text-text-muted line-through'
            : t.type === 'income'
              ? 'text-success'
              : t.type === 'expense'
                ? 'text-danger'
                : 'text-text'
        )}
      >
        {hideBalances
          ? '••••'
          : (t.type === 'expense' ? '-' : t.type === 'income' ? '+' : '') +
            formatMoney(t.amount, t.currency, { full: isCrypto(t.currency) })}
      </span>
    </div>
  )
}
