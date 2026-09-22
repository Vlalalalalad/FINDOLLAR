import type { Transaction } from '../types/database'

/**
 * Debt movements stay one-sided income/expense rows internally because that
 * sign changes the selected asset balance. This system tag identifies their
 * origin so reports can treat them as neutral without changing that balance.
 * Unlike debt_id, it survives deleting the debt itself.
 */
export const DEBT_TRANSACTION_TAG = 'system:debt'

type DebtTransactionLike = Pick<Transaction, 'debt_id' | 'tags' | 'description' | 'category_id'>

export function isDebtTransaction(transaction: DebtTransactionLike): boolean {
  if (transaction.debt_id) return true
  if (Array.isArray(transaction.tags) && transaction.tags.includes(DEBT_TRANSACTION_TAG)) return true

  // Compatibility with rows created before the durable tag existed,
  // including debts that have since been deleted and lost their debt_id.
  if (transaction.category_id) return false
  const description = transaction.description?.trim() ?? ''
  return description.startsWith('Додано до боргу:') || description.startsWith('Погашення боргу:')
}
