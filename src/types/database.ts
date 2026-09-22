export type AccountType = 'cash' | 'card' | 'bank' | 'crypto' | 'wallet' | 'other'
export type CategoryType = 'income' | 'expense'
export type TransactionType = 'income' | 'expense' | 'transfer'
export type Mood = 'great' | 'neutral' | 'regret'
export type DebtDirection = 'owed_to_me' | 'i_owe'
export type DebtStatus = 'open' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled'

export interface Profile {
  id: string
  full_name: string | null
  base_currency: string
  created_at: string
  updated_at: string
}

export interface Account {
  id: string
  user_id: string
  name: string
  type: AccountType
  currency: string
  starting_balance: number
  card_number: string | null
  is_locked: boolean
  color: string
  is_archived: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface Category {
  id: string
  user_id: string
  parent_id: string | null
  name: string
  type: CategoryType
  color: string
  icon: string | null
  is_archived: boolean
  is_default: boolean
  sort_order: number
  created_at: string
}

export interface Debt {
  id: string
  user_id: string
  direction: DebtDirection
  counterparty: string
  amount: number
  currency: string
  due_date: string | null
  occurred_on: string
  status: DebtStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export type DebtEntryKind = 'increase' | 'repayment'

export interface DebtEntry {
  id: string
  user_id: string
  debt_id: string
  kind: DebtEntryKind
  amount: number
  description: string | null
  occurred_at: string
  created_at: string
}

export interface ExchangeRate {
  id: string
  user_id: string
  currency: string
  rate_to_base: number
  updated_at: string
}

export interface Transaction {
  id: string
  user_id: string
  account_id: string | null
  transfer_to_account_id: string | null
  account_name_snapshot: string | null
  transfer_to_account_name_snapshot: string | null
  category_id: string | null
  debt_id: string | null
  is_cancelled: boolean
  type: TransactionType
  amount: number
  currency: string
  description: string | null
  mood: Mood | null
  tags: string[]
  is_pinned: boolean
  occurred_at: string
  created_at: string
  updated_at: string
}
