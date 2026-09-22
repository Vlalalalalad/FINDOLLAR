import { useCapital } from '../hooks/useCapital'
import { useCategories } from '../hooks'
import { useTheme } from '../context/ThemeContext'
import { AccountsSection } from '../components/AccountsSection'

export function Accounts() {
  const {
    accounts,
    transactions,
    createTransaction,
    updateTransaction,
    createAccount,
    updateAccount,
    removeAccount,
    reorderAccounts,
    accountBalances,
    loading,
  } = useCapital()
  const { data: categories, loading: categoriesLoading } = useCategories()
  const { hideBalances } = useTheme()

  return (
    <AccountsSection
      title="Активи"
      accounts={accounts}
      accountBalances={accountBalances}
      transactions={transactions}
      categories={categories}
      createTransaction={createTransaction}
      updateTransaction={updateTransaction}
      hideBalances={hideBalances}
      loading={loading || categoriesLoading}
      create={createAccount}
      update={updateAccount}
      remove={removeAccount}
      reorder={reorderAccounts}
    />
  )
}
