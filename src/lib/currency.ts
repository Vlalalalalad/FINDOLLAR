export const CURRENCIES = ['UAH', 'USD', 'EUR', 'USDT', 'BTC', 'ETH', 'GBP', 'PLN'] as const

export const CRYPTO = new Set(['USDT', 'BTC', 'ETH'])
export const isCrypto = (currency: string) => CRYPTO.has(currency)

/** Форматує суму БЕЗ коду/символу валюти — коли валюта вже показана окремо поруч (напр. пікером). */
export function formatAmount(amount: number): string {
  return new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
}

/**
 * `full` вмикає повну точність для крипти (USDT — 4 знаки, BTC/ETH — 8,
 * рівень сатоші) — використовується лише там, де це справді потрібно
 * (деталі рахунку в USDT/BTC/ETH), а не всюди типу картки рахунків чи
 * Огляду, де завжди лишається звичне округлене відображення.
 */
export function formatMoney(amount: number, currency: string, options?: { full?: boolean }): string {
  if (CRYPTO.has(currency)) {
    const normalDigits = currency === 'BTC' || currency === 'ETH' ? 6 : 2
    const fullDigits = currency === 'BTC' || currency === 'ETH' ? 8 : 4
    const digits = options?.full ? fullDigits : normalDigits
    return `${amount.toLocaleString('uk-UA', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}`
  }
  try {
    return new Intl.NumberFormat('uk-UA', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

/**
 * Конвертує суму з `currency` у `base` за курсами користувача.
 *
 * Конвенція курсів (узгоджена з таблицею exchange_rates та Профілем):
 * ratesToBase[currency] = скільки одиниць `base` коштує 1 одиниця currency.
 * Приклад: base = 'UAH', ratesToBase['USD'] = 41.5 -> 1 USD = 41.5 UAH.
 *
 * Повертає null, якщо курс для цієї валюти ще не заданий — це свідомо,
 * щоб виклики могли явно попередити "капітал неповний", а не тихо
 * порахувати суму, ніби курс дорівнює 1 чи 0.
 */
export function convertToBase(
  amount: number,
  currency: string,
  base: string,
  ratesToBase: Record<string, number>
): number | null {
  if (currency === base) return amount
  const rate = ratesToBase[currency]
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null
  return amount * rate
}
