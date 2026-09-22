import { useSupabaseTable } from './useSupabaseTable'
import type { Account, Category, Debt, DebtEntry, Transaction } from '../types/database'

export function useAccounts() {
  return useSupabaseTable<Account>('accounts', { orderBy: 'sort_order', ascending: true })
}

export function useCategories() {
  return useSupabaseTable<Category>('categories', { orderBy: 'sort_order', ascending: true })
}

export function useDebts() {
  return useSupabaseTable<Debt>('debts', { orderBy: 'created_at', ascending: false })
}

export function useDebtEntries() {
  return useSupabaseTable<DebtEntry>('debt_entries', { orderBy: 'occurred_at', ascending: false })
}

export function useTransactions() {
  return useSupabaseTable<Transaction>('transactions', { orderBy: 'occurred_at', ascending: false })
}
