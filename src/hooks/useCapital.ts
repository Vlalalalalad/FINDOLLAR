import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useAccounts, useDebts, useTransactions } from './index'
import { useExchangeRates } from './useExchangeRates'
import { useProfile } from './useProfile'
import { convertToBase } from '../lib/currency'
import { supabase } from '../lib/supabase'
import { isDebtTransaction } from '../lib/transactions'

const RATES_REFRESH_MS = 12 * 60 * 60 * 1000 // курси вважаються застарілими через 12 год

export interface CurrencySummary {
  currency: string
  freeBalance: number
  lockedBalance: number
  totalBalance: number
  owedToMe: number
  iOwe: number
  netWorth: number
  incomeThisMonth: number
  expenseThisMonth: number
}

export function useCapital() {
  const {
    data: accounts,
    loading: accLoading,
    create: createAccount,
    update: updateAccount,
    remove: removeAccountRaw,
    reorder: reorderAccounts,
  } = useAccounts()
  const { data: transactions, loading: txLoading, create: createTransaction, update: updateTransaction } = useTransactions()
  const { data: debts, loading: debtLoading } = useDebts()
  const { rates, ratesMap, loading: ratesLoading, refresh: refreshRates } = useExchangeRates()
  const { profile, loading: profileLoading, updateProfile } = useProfile()

  const baseCurrency = profile?.base_currency ?? 'UAH'

  // Реальний поточний баланс кожного рахунку: стартовий баланс + усі
  // операції, що на нього впливають (дохід/витрата/переказ в обидва боки).
  // account_id / transfer_to_account_id можуть бути порожні, якщо
  // відповідний рахунок відтоді видалили — операція лишається в історії,
  // просто вже нема живого рахунку, чий баланс нею змінювати.
  const accountBalances = useMemo(() => {
    const balanceByAccount = new Map<string, number>()
    accounts.forEach(a => balanceByAccount.set(a.id, a.starting_balance))

    transactions.forEach(t => {
      if (t.is_cancelled) return
      if (t.type === 'income') {
        if (t.account_id) balanceByAccount.set(t.account_id, (balanceByAccount.get(t.account_id) ?? 0) + t.amount)
      } else if (t.type === 'expense') {
        if (t.account_id) balanceByAccount.set(t.account_id, (balanceByAccount.get(t.account_id) ?? 0) - t.amount)
      } else if (t.type === 'transfer') {
        if (t.account_id) balanceByAccount.set(t.account_id, (balanceByAccount.get(t.account_id) ?? 0) - t.amount)
        if (t.transfer_to_account_id) {
          balanceByAccount.set(
            t.transfer_to_account_id,
            (balanceByAccount.get(t.transfer_to_account_id) ?? 0) + t.amount
          )
        }
      }
    })

    return Object.fromEntries(balanceByAccount) as Record<string, number>
  }, [accounts, transactions])

  const summaries = useMemo<CurrencySummary[]>(() => {
    const byCurrency = new Map<string, CurrencySummary>()
    const ensure = (currency: string) => {
      if (!byCurrency.has(currency)) {
        byCurrency.set(currency, {
          currency,
          freeBalance: 0,
          lockedBalance: 0,
          totalBalance: 0,
          owedToMe: 0,
          iOwe: 0,
          netWorth: 0,
          incomeThisMonth: 0,
          expenseThisMonth: 0,
        })
      }
      return byCurrency.get(currency)!
    }

    accounts.forEach(a => {
      const s = ensure(a.currency)
      const bal = accountBalances[a.id] ?? a.starting_balance
      if (a.is_locked) s.lockedBalance += bal
      else s.freeBalance += bal
    })

    debts
      .filter(d => d.status !== 'paid' && d.status !== 'cancelled')
      .forEach(d => {
        const s = ensure(d.currency)
        if (d.direction === 'owed_to_me') s.owedToMe += d.amount
        else s.iOwe += d.amount
      })

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    transactions.forEach(t => {
      if (t.is_cancelled || isDebtTransaction(t)) return
      if (new Date(t.occurred_at) >= monthStart) {
        const s = ensure(t.currency)
        if (t.type === 'income') s.incomeThisMonth += t.amount
        if (t.type === 'expense') s.expenseThisMonth += t.amount
      }
    })

    byCurrency.forEach(s => {
      s.totalBalance = s.freeBalance + s.lockedBalance
      s.netWorth = s.totalBalance + s.owedToMe - s.iOwe
    })

    return Array.from(byCurrency.values()).sort((a, b) => a.currency.localeCompare(b.currency))
  }, [accounts, debts, transactions, accountBalances])

  // Валюти, яким справді потрібен курс: є на рахунках, ненульовий баланс,
  // і це не сама базова валюта (для неї курс не потрібен, він 1:1).
  const currenciesNeedingRates = useMemo(
    () => summaries.filter(s => s.currency !== baseCurrency && s.totalBalance !== 0).map(s => s.currency),
    [summaries, baseCurrency]
  )

  // Автооновлення курсів: якщо є валюти, яким потрібен курс, і
  // найстаріший збережений курс старший за 12 год (або курсів ще нема
  // взагалі) — тихо запускаємо Edge Function fetch-rates у фоні. Один раз
  // за час життя компонента (щоб не смикати функцію на кожен рендер) —
  // при наступному відкритті застосунку перевірка повториться.
  const autoRefreshTriedRef = useRef(false)
  useEffect(() => {
    if (autoRefreshTriedRef.current) return
    if (ratesLoading) return
    if (currenciesNeedingRates.length === 0) return

    const oldestUpdatedAt = rates.reduce<number | null>((min, r) => {
      const t = new Date(r.updated_at).getTime()
      return min === null || t < min ? t : min
    }, null)
    const isStale = oldestUpdatedAt === null || Date.now() - oldestUpdatedAt > RATES_REFRESH_MS
    if (!isStale) return

    autoRefreshTriedRef.current = true
    supabase.functions
      .invoke('fetch-rates')
      .then(({ error }) => {
        if (!error) refreshRates()
      })
      .catch(() => {
        // Немає інтернету, функція ще не задеплоєна тощо — мовчки лишаємо
        // курси як є, спробуємо знову наступного разу.
      })
  }, [currenciesNeedingRates, rates, ratesLoading, refreshRates])

  // Загальний капітал по всіх валютах разом, сконвертований у базову
  // валюту профілю. Валюти без заданого курсу не губляться мовчки —
  // вони перелічені в missingRates, щоб інтерфейс міг чесно попередити,
  // що сума неповна, а не видати занижене число без пояснень.
  const { totalInBase, missingRates } = useMemo(() => {
    let total = 0
    const missing: string[] = []
    summaries.forEach(s => {
      if (s.totalBalance === 0) return
      const converted = convertToBase(s.totalBalance, s.currency, baseCurrency, ratesMap)
      if (converted === null) missing.push(s.currency)
      else total += converted
    })
    return { totalInBase: total, missingRates: missing }
  }, [summaries, baseCurrency, ratesMap])

  // % зміни загального капіталу з початку цього місяця. Баланс на
  // початок місяця відновлюємо, "розмотуючи" операції цього місяця
  // назад від поточного балансу (перекази нейтральні для капіталу
  // валюти — рахуються лише дохід/витрата). Конвертація — за поточними
  // курсами (без історичних курсів це наближення, але для трекера
  // особистих фінансів цього достатньо). Якщо для якоїсь валюти немає
  // курсу — краще не показати %, ніж показати оманливе число.
  const monthChangePercent = useMemo(() => {
    let current = 0
    let start = 0
    let incomplete = false
    summaries.forEach(s => {
      if (s.totalBalance === 0 && s.incomeThisMonth === 0 && s.expenseThisMonth === 0) return
      const convertedNow = convertToBase(s.totalBalance, s.currency, baseCurrency, ratesMap)
      const balanceAtMonthStart = s.totalBalance - s.incomeThisMonth + s.expenseThisMonth
      const convertedStart = convertToBase(balanceAtMonthStart, s.currency, baseCurrency, ratesMap)
      if (convertedNow === null || convertedStart === null) {
        incomplete = true
        return
      }
      current += convertedNow
      start += convertedStart
    })
    if (incomplete || Math.abs(start) < 0.01) return null
    return ((current - start) / Math.abs(start)) * 100
  }, [summaries, baseCurrency, ratesMap])

  // Дає змогу змінити базову валюту прямо з картки на Огляді: одразу
  // зберігає вибір і тут-таки тягне свіжі курси відносно нової бази,
  // щоб капітал не блимнув неправильним числом на старих курсах.
  // Повертає, чи вдалось оновити курси — якщо ні, виклик має попередити
  // користувача, а не тихо показати суму по старих (уже невірних) курсах.
  const setBaseCurrency = useCallback(
    async (newBase: string): Promise<{ ratesRefreshed: boolean }> => {
      await updateProfile({ base_currency: newBase })
      try {
        const { error } = await supabase.functions.invoke('fetch-rates')
        if (error) return { ratesRefreshed: false }
        await refreshRates()
        return { ratesRefreshed: true }
      } catch {
        return { ratesRefreshed: false }
      }
    },
    [updateProfile, refreshRates]
  )

  // Дохід/витрати цього місяця по всіх валютах разом, сконвертовані в
  // базову валюту — для картки "Статистика" на Огляді (та сама валюта
  // й та сама кнопка, що керує загальним капіталом).
  const { incomeInBase, expenseInBase } = useMemo(() => {
    let income = 0
    let expense = 0
    summaries.forEach(s => {
      if (s.incomeThisMonth !== 0) {
        const converted = convertToBase(s.incomeThisMonth, s.currency, baseCurrency, ratesMap)
        if (converted !== null) income += converted
      }
      if (s.expenseThisMonth !== 0) {
        const converted = convertToBase(s.expenseThisMonth, s.currency, baseCurrency, ratesMap)
        if (converted !== null) expense += converted
      }
    })
    return { incomeInBase: income, expenseInBase: expense }
  }, [summaries, baseCurrency, ratesMap])

  // Перед видаленням рахунку робимо знімок його назви на всіх операціях,
  // де він фігурує (як джерело чи як отримувач переказу) — щоб історія
  // й далі показувала справжню назву, а не загальну "рахунок видалено".
  // Сам рахунок після цього видаляється насправді (0003: account_id
  // ON DELETE SET NULL — жодна операція каскадно не зникає).
  const removeAccount = useCallback(
    async (accountId: string) => {
      const account = accounts.find(a => a.id === accountId)
      if (account) {
        await Promise.all([
          supabase.from('transactions').update({ account_name_snapshot: account.name }).eq('account_id', accountId),
          supabase
            .from('transactions')
            .update({ transfer_to_account_name_snapshot: account.name })
            .eq('transfer_to_account_id', accountId),
        ])
      }
      await removeAccountRaw(accountId)
    },
    [accounts, removeAccountRaw]
  )

  return {
    accounts,
    transactions,
    createTransaction,
    updateTransaction,
    createAccount,
    updateAccount,
    removeAccount,
    reorderAccounts,
    summaries,
    accountBalances,
    baseCurrency,
    setBaseCurrency,
    ratesMap,
    totalInBase,
    missingRates,
    monthChangePercent,
    incomeInBase,
    expenseInBase,
    ratesLoading,
    // ratesLoading повертається окремо для першого коректного рендера,
    // але свідомо НЕ входить у загальний loading. Курси оновлюються у фоні
    // (і одразу після монтування, якщо застаріли, і при зміні базової
    // валюти) — і useExchangeRates на час такого фонового оновлення сам
    // піднімає свій внутрішній loading. Якби він враховувався тут, уся
    // сторінка ховалась би й показувалась заново щоразу, коли фонове
    // оновлення курсів спрацьовує саме — це і було причиною "блимання"
    // Огляду десь через півсекунди після відкриття.
    loading: accLoading || txLoading || debtLoading || profileLoading,
  }
}
