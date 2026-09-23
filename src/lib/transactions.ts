import type { Category, CategoryType, Transaction, TransactionType } from '../types/database'

const CATEGORY_FALLBACKS: Record<CategoryType, { label: string; aliases: string[] }> = {
  expense: { label: 'Інші витрати', aliases: ['Інші витрати', 'Інші'] },
  income: { label: 'Інший дохід', aliases: ['Інший дохід', 'Інші доходи', 'Інші'] },
}

export type CategoryPresentation = {
  id: string | null
  key: string
  name: string
  color: string
}

export function fallbackCategory(categories: Category[], type: CategoryType): Category | undefined {
  const aliases = CATEGORY_FALLBACKS[type].aliases
  return categories.find(category => category.type === type && category.is_default && aliases.includes(category.name.trim()))
    ?? categories.find(category => category.type === type && aliases.includes(category.name.trim()))
}

export function categoryPresentation(
  categories: Category[],
  type: CategoryType,
  categoryId: string | null,
): CategoryPresentation {
  const assigned = categoryId ? categories.find(category => category.id === categoryId && category.type === type) : undefined
  const category = assigned ?? fallbackCategory(categories, type)
  return {
    id: category?.id ?? null,
    key: category?.id ?? 'fallback:' + type,
    name: category?.name ?? CATEGORY_FALLBACKS[type].label,
    color: category?.color ?? '#6B6A63',
  }
}

export function transactionCategoryName(
  categories: Category[],
  type: TransactionType,
  categoryId: string | null,
): string {
  return type === 'transfer' ? '' : categoryPresentation(categories, type, categoryId).name
}

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
