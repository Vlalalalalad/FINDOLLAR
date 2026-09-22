import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowLeft, ChevronDown, Divide, Equal, History, Minus, Percent, Plus, X } from 'lucide-react'
import clsx from 'clsx'
import { useCapital } from '../hooks/useCapital'
import { CURRENCIES } from '../lib/currency'
import { usePresence } from '../hooks/usePresence'
import { useAuth } from '../context/AuthContext'
import { accountStorage } from '../lib/accountStorage'
import {
  calculatorNumber,
  convertCalculatorExpression,
  evaluateCalculatorExpression,
  formatCalculatorExpression,
  isCalculatorOperator,
  lastNumberLiteral,
  normalizeCalculatorExpression,
  replaceTrailingNumber,
  roundCalculatorNumber,
  trailingNumberLiteral,
  unmatchedOpeningParentheses,
  type CalculatorOperator,
} from '../lib/calculator'

type PickerTarget = number | 'add' | null
type SavedCalculatorState = {
  activeRowIndex: number
  baseAmount: number | null
  expressionText: string
  justEvaluated: boolean
}
type CalculatorHistoryEntry = { id: string; expression: string; result: string }

const INITIAL_CURRENCIES = CURRENCIES.slice(0, 5) as unknown as string[]
const currencySet = new Set<string>(CURRENCIES)
const currenciesWithTwoDecimals = new Set(['UAH', 'USD', 'EUR', 'GBP', 'PLN'])
const CALCULATOR_STATE_KEY = 'findossar-calculator-state'
const CALCULATOR_CURRENCIES_KEY = 'findossar-calculator-currencies'
const CALCULATOR_HISTORY_KEY = 'findossar-calculator-history'

function readSavedCurrencies(storage: ReturnType<typeof accountStorage>) {
  try {
    const saved = JSON.parse(storage.getItem(CALCULATOR_CURRENCIES_KEY) ?? 'null')
    if (Array.isArray(saved)) {
      const valid = saved.filter((currency): currency is string => typeof currency === 'string' && currencySet.has(currency))
      if (valid.length >= 2) return valid.slice(0, 5)
    }
  } catch {
    // Storage is optional; the calculator still works in private mode.
  }
  return [...INITIAL_CURRENCIES]
}

function legacyExpression(saved: Record<string, unknown>) {
  const tokens = Array.isArray(saved.expression)
    ? saved.expression.filter(token =>
        (typeof token === 'number' && Number.isFinite(token)) ||
        (typeof token === 'string' && isCalculatorOperator(token))
      )
    : []
  const source = tokens.map(token => String(token)).join('')
  const waiting = saved.waitingForOperand === true
  const input = typeof saved.input === 'string' ? saved.input : '0'
  return normalizeCalculatorExpression(source + (!waiting || source.length === 0 ? input : '')) || '0'
}

function readSavedCalculatorState(currencies: string[], storage: ReturnType<typeof accountStorage>): SavedCalculatorState {
  try {
    const saved = JSON.parse(storage.getItem(CALCULATOR_STATE_KEY) ?? 'null') as Record<string, unknown> | null
    if (!saved) throw new Error('No calculator state')
    const requestedIndex = typeof saved.activeRowIndex === 'number' && Number.isInteger(saved.activeRowIndex)
      ? saved.activeRowIndex
      : 0
    const activeRowIndex = Math.max(0, Math.min(requestedIndex, currencies.length - 1))
    const baseAmount = saved.baseAmount === null
      ? null
      : typeof saved.baseAmount === 'number' && Number.isFinite(saved.baseAmount)
        ? saved.baseAmount
        : 100
    const expressionText = typeof saved.expressionText === 'string'
      ? normalizeCalculatorExpression(saved.expressionText) || '0'
      : legacyExpression(saved)
    return {
      activeRowIndex,
      baseAmount,
      expressionText,
      justEvaluated: typeof saved.justEvaluated === 'boolean' ? saved.justEvaluated : false,
    }
  } catch {
    return { activeRowIndex: 0, baseAmount: 100, expressionText: '100', justEvaluated: true }
  }
}

function readSavedHistory(storage: ReturnType<typeof accountStorage>) {
  try {
    const saved = JSON.parse(storage.getItem(CALCULATOR_HISTORY_KEY) ?? '[]')
    if (!Array.isArray(saved)) return []
    const sanitized = saved
      .filter((entry): entry is CalculatorHistoryEntry => {
        if (!entry || typeof entry !== 'object') return false
        const item = entry as Record<string, unknown>
        if (typeof item.expression !== 'string' || typeof item.result !== 'string') return false
        const expression = normalizeCalculatorExpression(item.expression)
        const result = normalizeCalculatorExpression(item.result)
        return Boolean(expression && result && evaluateCalculatorExpression(expression) !== null)
      })
      .map((entry, index) => ({
        id: typeof entry.id === 'string' ? entry.id : `saved-${index}-${entry.expression}-${entry.result}`,
        expression: normalizeCalculatorExpression(entry.expression),
        result: normalizeCalculatorExpression(entry.result),
      }))
    const seen = new Set<string>()
    return sanitized
      .filter(entry => {
        const key = `${entry.expression}\u0000${entry.result}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(-20)
  } catch {
    return []
  }
}

function parseNumericInput(value: string) {
  const number = Number(value.replace(',', '.'))
  return Number.isFinite(number) ? number : 0
}

function formatValue(value: number | null, currency?: string) {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: currency && currenciesWithTwoDecimals.has(currency) ? 2 : 8,
  }).format(value)
}

function currentExpressionAmount(expression: string) {
  const source = normalizeCalculatorExpression(expression)
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(source) || source.endsWith(')')) {
    const result = evaluateCalculatorExpression(source)
    if (result !== null) return result
  }
  return parseNumericInput(trailingNumberLiteral(source) ?? lastNumberLiteral(source) ?? '0')
}

function binaryOperatorIn(expression: string) {
  const source = normalizeCalculatorExpression(expression)
  return [...source].some((character, index) => {
    if (!isCalculatorOperator(character)) return false
    if (character === '*' || character === '/') return true
    const previous = source[index - 1]
    return index > 0 && previous !== '(' && !isCalculatorOperator(previous)
  })
}

/** Replays a saved value through the same editing rules as keyboard input. */
function insertCalculatorValue(current: string, value: string) {
  let source = normalizeCalculatorExpression(current)

  for (const token of normalizeCalculatorExpression(value)) {
    if (/^[0-9]$/.test(token)) {
      if (source.endsWith(')')) source += '*'
      const trailing = trailingNumberLiteral(source)
      source = trailing === '0' ? source.slice(0, -1) + token : source + token
      continue
    }

    if (token === '.') {
      if (source.endsWith(')')) source += '*'
      const trailing = trailingNumberLiteral(source)
      if (!trailing?.includes('.')) source += trailing ? '.' : '0.'
      continue
    }

    if (isCalculatorOperator(token)) {
      const last = source[source.length - 1]
      if (!last) {
        if (token === '+' || token === '-') source = token
      } else if (isCalculatorOperator(last)) source = source.slice(0, -1) + token
      else if (last === '(') {
        if (token === '+' || token === '-') source += token
      } else if (last !== '.') source += token
      continue
    }

    if (token === '(') {
      const last = source[source.length - 1]
      if (last && last !== '(' && !isCalculatorOperator(last)) source += '*'
      source += '('
      continue
    }

    if (token === ')') {
      const last = source[source.length - 1]
      if (unmatchedOpeningParentheses(source) > 0 && last && last !== '(' && !isCalculatorOperator(last)) source += ')'
    }
  }

  return source || '0'
}

function makeHistoryId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function updateExpressionFade(node: HTMLDivElement) {
  node.dataset.scrolledLeft = node.scrollLeft > 0.5 ? 'true' : 'false'
}

export function Calculator() {
  const { user } = useAuth()
  const storage = useMemo(() => accountStorage(user!.id), [user?.id])
  const { ratesMap, baseCurrency, loading, ratesLoading } = useCapital()
  const [initialSnapshot] = useState(() => {
    const currencies = readSavedCurrencies(storage)
    return { currencies, state: readSavedCalculatorState(currencies, storage), history: readSavedHistory(storage) }
  })
  const [currencies, setCurrencies] = useState(initialSnapshot.currencies)
  const [activeRowIndex, setActiveRowIndex] = useState(initialSnapshot.state.activeRowIndex)
  const [baseAmount, setBaseAmount] = useState<number | null>(initialSnapshot.state.baseAmount)
  const [expressionText, setExpressionText] = useState(initialSnapshot.state.expressionText)
  const [justEvaluated, setJustEvaluated] = useState(initialSnapshot.state.justEvaluated)
  const [history, setHistory] = useState<CalculatorHistoryEntry[]>(initialSnapshot.history)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null)
  const [error, setError] = useState<string | null>(null)
  const historyListRef = useRef<HTMLDivElement>(null)
  const expressionScrollRef = useRef<HTMLDivElement>(null)
  const expressionDragRef = useRef<{ pointerId: number; startX: number; startScrollLeft: number } | null>(null)
  const initialDisplayRef = useRef(initialSnapshot.state.baseAmount === null)

  const activeCurrency = currencies[activeRowIndex] ?? currencies[0] ?? 'UAH'
  const activeOperator = (() => {
    const last = expressionText[expressionText.length - 1]
    return last && isCalculatorOperator(last) ? last : null
  })()
  const availableCurrencies = useMemo(
    () => currencies.length >= 5 ? [] : CURRENCIES.filter(currency => !currencies.includes(currency)),
    [currencies]
  )
  const addPickerPresent = usePresence(pickerTarget === 'add', 140)
  const lastAvailableCurrencies = useRef<readonly string[]>(availableCurrencies)
  if (pickerTarget === 'add') lastAvailableCurrencies.current = availableCurrencies

  useEffect(() => {
    try { storage.setItem(CALCULATOR_CURRENCIES_KEY, JSON.stringify(currencies)) } catch { /* optional */ }
  }, [currencies, storage])

  useEffect(() => {
    try {
      storage.setItem(CALCULATOR_STATE_KEY, JSON.stringify({
        activeRowIndex,
        baseAmount,
        expressionText,
        justEvaluated,
      } satisfies SavedCalculatorState))
    } catch { /* optional */ }
  }, [activeRowIndex, baseAmount, expressionText, justEvaluated, storage])

  useEffect(() => {
    try { storage.setItem(CALCULATOR_HISTORY_KEY, JSON.stringify(history.slice(-20))) } catch { /* optional */ }
  }, [history, storage])

  useLayoutEffect(() => {
    document.documentElement.classList.add('calculator-route')
    document.body.classList.add('calculator-route')
    return () => {
      document.documentElement.classList.remove('calculator-route')
      document.body.classList.remove('calculator-route')
    }
  }, [])

  useLayoutEffect(() => {
    if (!historyOpen || !historyListRef.current) return
    historyListRef.current.scrollTop = historyListRef.current.scrollHeight
  }, [historyOpen, history.length])

  useLayoutEffect(() => {
    const node = expressionScrollRef.current
    if (!node) return
    node.scrollLeft = node.scrollWidth
    updateExpressionFade(node)
  }, [expressionText])

  useEffect(() => {
    const node = expressionScrollRef.current
    if (!node) return

    const handleWheel = (event: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (delta === 0) return
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientWidth : 1
      const before = node.scrollLeft
      node.scrollLeft += delta * scale
      updateExpressionFade(node)
      if (Math.abs(node.scrollLeft - before) > 0.5) event.preventDefault()
    }

    node.addEventListener('wheel', handleWheel, { passive: false })
    return () => node.removeEventListener('wheel', handleWheel)
  }, [])

  const startExpressionDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const node = event.currentTarget
    if (event.pointerType !== 'mouse' || event.button !== 0 || node.scrollWidth <= node.clientWidth) return
    expressionDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: node.scrollLeft }
    node.setPointerCapture(event.pointerId)
    node.classList.add('is-dragging')
    event.preventDefault()
  }

  const moveExpressionDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = expressionDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const node = event.currentTarget
    node.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startX)
    updateExpressionFade(node)
    event.preventDefault()
  }

  const stopExpressionDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = expressionDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    expressionDragRef.current = null
    const node = event.currentTarget
    node.classList.remove('is-dragging')
    if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId)
  }

  const rateToBase = (currency: string) => {
    if (currency === baseCurrency) return 1
    const rate = Number(ratesMap[currency])
    return Number.isFinite(rate) && rate > 0 ? rate : null
  }

  const valueFor = (currency: string) => {
    const rate = rateToBase(currency)
    return baseAmount === null || rate === null ? null : baseAmount / rate
  }

  const convertBetween = (amount: number, from: string, to: string) => {
    if (from === to) return amount
    const fromRate = rateToBase(from)
    const toRate = rateToBase(to)
    if (fromRate === null || toRate === null) return null
    return roundCalculatorNumber((amount * fromRate) / toRate)
  }

  const syncAmountToBase = (amount: number, currency = activeCurrency) => {
    const rate = rateToBase(currency)
    setBaseAmount(rate === null ? null : roundCalculatorNumber(amount * rate))
  }

  useLayoutEffect(() => {
    if (loading || ratesLoading || !initialDisplayRef.current || !currencies.includes(activeCurrency)) return
    const current = valueFor(activeCurrency)
    if (current !== null) setExpressionText(calculatorNumber(current))
    initialDisplayRef.current = false
  }, [loading, ratesLoading, currencies, activeCurrency, baseAmount, baseCurrency, ratesMap])

  const setActive = (currency: string, rowIndex = currencies.findIndex(item => item === currency)) => {
    initialDisplayRef.current = false
    if (currency !== activeCurrency) {
      const converted = convertCalculatorExpression(expressionText, amount => convertBetween(amount, activeCurrency, currency))
      if (converted === null) {
        setError(`Немає курсу для переходу ${activeCurrency} → ${currency}`)
        return
      }
      setExpressionText(converted || calculatorNumber(valueFor(currency) ?? 0))
    }
    if (rowIndex >= 0) setActiveRowIndex(rowIndex)
    setError(null)
  }

  const openPicker = (index: number, currency: string) => {
    setActive(currency, index)
    setPickerTarget(current => current === index ? null : index)
  }

  const removeCurrency = (index: number) => {
    if (currencies.length <= 2) {
      setPickerTarget(null)
      return
    }
    const nextCurrencies = currencies.filter((_, itemIndex) => itemIndex !== index)
    setCurrencies(nextCurrencies)
    if (activeRowIndex === index) {
      const nextIndex = Math.min(index, nextCurrencies.length - 1)
      setActive(nextCurrencies[nextIndex] ?? 'UAH', nextIndex)
    } else if (activeRowIndex > index) setActiveRowIndex(activeRowIndex - 1)
    setPickerTarget(null)
  }

  const chooseCurrency = (currency: string) => {
    if (pickerTarget === 'add') {
      if (currencies.length < 5 && !currencies.includes(currency)) {
        setCurrencies(current => [...current, currency])
        setActive(currency, currencies.length)
      }
      setPickerTarget(null)
      return
    }
    if (typeof pickerTarget !== 'number') return
    const rowIndex = pickerTarget
    const replaced = currencies[rowIndex]
    if (!replaced) return setPickerTarget(null)
    if (currency === replaced) return removeCurrency(rowIndex)
    setCurrencies(current => current.map((item, index) => index === rowIndex ? currency : item))
    if (activeRowIndex === rowIndex) setActive(currency, rowIndex)
    setPickerTarget(null)
  }

  const commitExpression = (next: string, evaluated = false) => {
    const normalized = normalizeCalculatorExpression(next) || '0'
    setExpressionText(normalized)
    setJustEvaluated(evaluated)
    syncAmountToBase(currentExpressionAmount(normalized))
  }

  const appendInput = (token: string) => {
    initialDisplayRef.current = false
    setError(null)
    let source = justEvaluated ? '' : expressionText
    if (source.endsWith(')')) source += '*'
    const trailing = trailingNumberLiteral(source)
    if (token === '.') {
      if (trailing?.includes('.')) return
      source += trailing ? '.' : '0.'
    } else if (trailing === '0') source = source.slice(0, -1) + token
    else source += token
    commitExpression(source, false)
  }

  const clear = () => {
    initialDisplayRef.current = false
    setExpressionText('0')
    setBaseAmount(0)
    setJustEvaluated(true)
    setError(null)
  }

  const backspace = () => {
    initialDisplayRef.current = false
    setError(null)
    const source = normalizeCalculatorExpression(expressionText)
    commitExpression(source.length > 1 ? source.slice(0, -1) : '0', false)
  }

  const chooseOperator = (nextOperator: CalculatorOperator) => {
    initialDisplayRef.current = false
    setError(null)
    let source = normalizeCalculatorExpression(expressionText) || '0'
    const last = source[source.length - 1]
    if (last && isCalculatorOperator(last)) source = source.slice(0, -1) + nextOperator
    else if (last === '(') {
      if (nextOperator !== '+' && nextOperator !== '-') return
      source += nextOperator
    } else if (last === '.') return
    else source += nextOperator
    setExpressionText(source)
    setJustEvaluated(false)
  }

  const addParenthesis = (requested?: '(' | ')') => {
    initialDisplayRef.current = false
    setError(null)
    let source = justEvaluated ? '' : normalizeCalculatorExpression(expressionText)
    const last = source[source.length - 1]
    const openings = unmatchedOpeningParentheses(source)
    const mayOpen = !last || last === '(' || Boolean(last && isCalculatorOperator(last))
    const mayClose = openings > 0 && Boolean(last) && last !== '(' && !Boolean(last && isCalculatorOperator(last))
    if (requested === ')') {
      if (!mayClose) return
      source += ')'
    } else if (requested === '(') {
      if (!mayOpen && last !== ')') source += '*'
      source += '('
    } else if (mayClose) source += ')'
    else {
      if (!mayOpen) source += '*'
      source += '('
    }
    setExpressionText(source)
    setJustEvaluated(false)
  }

  const equals = () => {
    initialDisplayRef.current = false
    const source = normalizeCalculatorExpression(expressionText)
    if (!binaryOperatorIn(source)) return
    const result = evaluateCalculatorExpression(source)
    if (result === null) {
      setError(source.includes('/0') ? 'Неможливо поділити на нуль' : 'Некоректний вираз')
      return
    }
    const resultText = calculatorNumber(result)
    setHistory(current => {
      const alreadySaved = current.some(entry => entry.expression === source && entry.result === resultText)
      if (alreadySaved) return current
      return [...current, { id: makeHistoryId(), expression: source, result: resultText }].slice(-20)
    })
    setExpressionText(resultText)
    setJustEvaluated(true)
    setError(null)
    syncAmountToBase(result)
  }

  const percent = () => {
    initialDisplayRef.current = false
    const source = normalizeCalculatorExpression(expressionText)
    const literal = trailingNumberLiteral(source)
    if (!literal) return
    const prefix = source.slice(0, -literal.length)
    const operator = prefix[prefix.length - 1]
    const current = Number(literal)
    let result = roundCalculatorNumber(current / 100)
    if ((operator === '+' || operator === '-') && prefix.length > 1) {
      const previous = evaluateCalculatorExpression(prefix.slice(0, -1))
      if (previous !== null) result = roundCalculatorNumber((previous * current) / 100)
    }
    commitExpression(replaceTrailingNumber(source, calculatorNumber(result)), false)
  }

  const insertHistoryValue = (value: string) => {
    initialDisplayRef.current = false
    setError(null)
    const source = justEvaluated ? '' : expressionText
    commitExpression(insertCalculatorValue(source, value), false)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (target instanceof HTMLButtonElement && (event.key === 'Enter' || event.key === ' ')) return
      const key = event.key
      if (/^[0-9]$/.test(key)) { event.preventDefault(); appendInput(key) }
      else if (key === '.' || key === ',') { event.preventDefault(); appendInput('.') }
      else if (key === '(' || key === ')') { event.preventDefault(); addParenthesis(key) }
      else if (key === 'ArrowUp' || key === 'ArrowDown') {
        event.preventDefault()
        if (!currencies.length) return
        const nextIndex = (activeRowIndex + (key === 'ArrowUp' ? -1 : 1) + currencies.length) % currencies.length
        if (currencies[nextIndex]) setActive(currencies[nextIndex], nextIndex)
      } else if (key === '+' || key === '-' || key === '*' || key === '/') { event.preventDefault(); chooseOperator(key) }
      else if (key === 'Enter' || key === '=') { event.preventDefault(); if (!event.repeat) equals() }
      else if (key === 'Backspace') { event.preventDefault(); backspace() }
      else if (key === 'Escape') {
        event.preventDefault()
        if (historyOpen) setHistoryOpen(false)
        else clear()
      } else if (key === 'Delete' || key.toLowerCase() === 'c') { event.preventDefault(); clear() }
      else if (key === '%') { event.preventDefault(); percent() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expressionText, justEvaluated, historyOpen, activeCurrency, activeRowIndex, currencies, baseCurrency, ratesMap])

  const valuesReady = !loading && !ratesLoading
  const missingRates = valuesReady ? currencies.filter(currency => rateToBase(currency) === null) : []
  const selectedAmount = currentExpressionAmount(expressionText)

  return (
    <section className="calculator-screen relative mx-auto flex min-h-[calc(100dvh-10rem)] w-full max-w-2xl flex-col gap-3 pb-2">
      <div className="calculator-upper flex min-h-0 flex-col gap-3">
        <div className="calculator-currency-list flex flex-col gap-3">
          {currencies.map((currency, index) => {
            const selected = activeRowIndex === index
            const amount = selected ? selectedAmount : valueFor(currency)
            return (
              <div key={index} className="calculator-currency-row relative grid grid-cols-[minmax(106px,0.9fr)_minmax(0,3.2fr)] gap-3">
                <div className={clsx(
                  'calculator-currency-side flex min-h-[64px] items-center gap-2 rounded-[1.25rem] border bg-surface-2 px-3 shadow-sm transition-colors',
                  selected ? 'border-primary/70 calculator-selected-control' : 'border-border'
                )}>
                  <button type="button" onClick={() => openPicker(index, currency)} className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none" aria-label={`Вибрати валюту ${currency}`}>
                    <span className="truncate text-sm font-extrabold text-text">{currency}</span>
                    <ChevronDown size={14} className="ml-auto shrink-0 text-text-muted" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setActive(currency, index)}
                  className={clsx(
                    'calculator-currency-value min-h-[64px] rounded-[1.25rem] border px-4 text-right text-2xl font-bold tabular-nums outline-none transition-colors sm:text-3xl',
                    selected ? 'border-primary bg-primary/10 text-primary shadow-sm calculator-selected-control' : 'border-border bg-surface-2 text-text hover:border-primary/50'
                  )}
                  aria-label={`Ввести суму у ${currency}`}
                >
                  {valuesReady || selected ? formatValue(amount, currency) : '—'}
                </button>
                <CurrencyPicker
                  open={pickerTarget === index}
                  options={CURRENCIES}
                  selected={currency}
                  onSelect={chooseCurrency}
                  onClose={() => setPickerTarget(null)}
                  title="Валюта або криптовалюта"
                />
              </div>
            )
          })}
        </div>

        <div className="calculator-add-wrap relative">
          {availableCurrencies.length > 0 && (
              <button
                type="button"
                onClick={() => setPickerTarget(current => current === 'add' ? null : 'add')}
                className="calculator-add flex min-h-10 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface/70 px-3 text-sm font-semibold text-text-muted transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
              >
                <Plus size={16} /> Додати валюту або криптовалюту
              </button>
          )}
          {(availableCurrencies.length > 0 || addPickerPresent) && (
            <CurrencyPicker
              open={pickerTarget === 'add'}
              options={pickerTarget === 'add' ? availableCurrencies : lastAvailableCurrencies.current}
              onSelect={chooseCurrency}
              onClose={() => setPickerTarget(null)}
              title="Додати рядок"
              wide
            />
          )}
          {missingRates.length > 0 && (
            <p className="calculator-rate-note motion-soft-enter mt-2 text-center text-[11px] text-text-muted">
              Для {missingRates.join(', ')} ще немає курсу — їх еквівалент буде доступний після налаштування курсу.
            </p>
          )}
        </div>
        {error && <p className="calculator-error motion-soft-enter text-center text-xs font-semibold text-danger">{error}</p>}
      </div>

      <div className="calculator-controls relative mt-auto flex min-h-0 flex-1 flex-col gap-2">
        <div className="calculator-expression-row grid">
          <div className="calculator-expression flex min-h-8 items-center overflow-hidden rounded-xl border border-border bg-surface/70 p-1 text-sm font-semibold tabular-nums text-text-muted">
            <button
              type="button"
              onClick={() => setHistoryOpen(open => !open)}
              aria-label="Історія розрахунків"
              aria-expanded={historyOpen}
              aria-controls="calculator-history"
              className={clsx(
                'calculator-history-action flex shrink-0 items-center justify-center rounded-lg outline-none transition-colors active:bg-surface-2',
                historyOpen ? 'bg-primary/10 text-primary' : 'text-text-muted hover:bg-surface-2 hover:text-text'
              )}
            ><History size={17} /></button>
            <div
              ref={expressionScrollRef}
              className="calculator-expression-scroll min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
              data-scrolled-left="false"
              onScroll={event => updateExpressionFade(event.currentTarget)}
              onPointerDown={startExpressionDrag}
              onPointerMove={moveExpressionDrag}
              onPointerUp={stopExpressionDrag}
              onPointerCancel={stopExpressionDrag}
              onLostPointerCapture={stopExpressionDrag}
            >
              <span className="calculator-expression-value block whitespace-nowrap px-2 text-right" aria-live="polite" aria-label="Поточний математичний вираз">
                {formatCalculatorExpression(expressionText) || '0'}
              </span>
            </div>
          </div>
          <button type="button" onClick={backspace} aria-label="Видалити останній символ" className="calculator-expression-action calculator-backspace-action flex items-center justify-center rounded-[1.15rem] border border-primary bg-primary text-white shadow-sm outline-none transition-colors hover:bg-primary-dark active:scale-[0.98] active:bg-primary-dark">
            <ArrowLeft size={21} />
          </button>
        </div>

        <div className="calculator-keypad grid grid-cols-4 pb-1 pt-1">
          <CalcButton label="C" onClick={clear} muted />
          <CalcButton label="( )" onClick={() => addParenthesis()} muted ariaLabel="Додати дужку" />
          <CalcButton label={<Percent size={23} />} onClick={percent} muted ariaLabel="Відсоток" />
          <CalcButton label={<Divide size={24} />} onClick={() => chooseOperator('/')} active={activeOperator === '/'} />
          <CalcButton label="7" onClick={() => appendInput('7')} muted />
          <CalcButton label="8" onClick={() => appendInput('8')} muted />
          <CalcButton label="9" onClick={() => appendInput('9')} muted />
          <CalcButton label="×" onClick={() => chooseOperator('*')} active={activeOperator === '*'} />
          <CalcButton label="4" onClick={() => appendInput('4')} muted />
          <CalcButton label="5" onClick={() => appendInput('5')} muted />
          <CalcButton label="6" onClick={() => appendInput('6')} muted />
          <CalcButton label={<Minus size={24} />} onClick={() => chooseOperator('-')} active={activeOperator === '-'} />
          <CalcButton label="1" onClick={() => appendInput('1')} muted />
          <CalcButton label="2" onClick={() => appendInput('2')} muted />
          <CalcButton label="3" onClick={() => appendInput('3')} muted />
          <CalcButton label={<Plus size={24} />} onClick={() => chooseOperator('+')} active={activeOperator === '+'} />
          <CalcButton label="0" onClick={() => appendInput('0')} muted wide />
          <CalcButton label="," onClick={() => appendInput('.')} muted />
          <CalcButton label={<Equal size={24} />} onClick={equals} />
        </div>

        <aside
          id="calculator-history"
          aria-hidden={!historyOpen}
          className={clsx(
            'calculator-history-panel absolute bottom-1 left-0 top-[calc(var(--calculator-expression-height)+0.5rem)] z-20 flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl transition-[transform,opacity] duration-200',
            historyOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-[108%] opacity-0'
          )}
        >
          <div className="border-b border-border px-3 py-2 text-xs font-bold text-text">Історія</div>
          <div ref={historyListRef} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
            {history.length === 0 ? (
              <p className="m-auto px-3 text-center text-xs text-text-muted">Завершені розрахунки з’являться тут.</p>
            ) : history.map(entry => (
              <div key={entry.id} className="rounded-xl border border-border bg-surface-2/70 p-1.5">
                <button type="button" tabIndex={historyOpen ? 0 : -1} onClick={() => insertHistoryValue(entry.expression)} className="block w-full rounded-lg px-2 py-1 text-left text-xs font-semibold text-text hover:bg-surface-3">
                  {formatCalculatorExpression(entry.expression)}
                </button>
                <button type="button" tabIndex={historyOpen ? 0 : -1} onClick={() => insertHistoryValue(entry.result)} className="block w-full rounded-lg px-2 py-1 text-left font-mono text-xs font-bold tabular-nums text-primary hover:bg-primary/10">
                  = {formatCalculatorExpression(entry.result)}
                </button>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  )
}

function CurrencyPicker({ open, options, selected, onSelect, onClose, title, wide = false }: {
  open: boolean
  options: readonly string[]
  selected?: string
  onSelect: (currency: string) => void
  onClose: () => void
  title: string
  wide?: boolean
}) {
  const present = usePresence(open, 140)
  const displayed = useRef({ options, selected, title })
  if (open) displayed.current = { options, selected, title }

  if (!present) return null

  return (
    <div
      data-state={open ? 'open' : 'closed'}
      className={clsx('motion-popover absolute left-0 top-[calc(100%+0.5rem)] z-30 rounded-2xl border border-border bg-surface p-3 shadow-xl', wide ? 'inset-x-0' : 'w-full')}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-text-muted">{displayed.current.title}</span>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-text-muted hover:bg-surface-2" aria-label="Закрити список"><X size={15} /></button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {displayed.current.options.map(currency => (
          <button key={currency} type="button" onClick={() => onSelect(currency)} className={clsx(
            'flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs font-bold transition-colors hover:bg-surface-2',
            currency === displayed.current.selected ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text'
          )}><span>{currency}</span></button>
        ))}
      </div>
    </div>
  )
}

function CalcButton({ label, onClick, muted = false, active = false, wide = false, ariaLabel }: {
  label: React.ReactNode
  onClick: () => void
  muted?: boolean
  active?: boolean
  wide?: boolean
  ariaLabel?: string
}) {
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className={clsx(
      'calculator-key flex aspect-square items-center justify-center rounded-[1.5rem] border text-2xl font-bold outline-none transition-colors active:scale-[0.98] focus:outline-none focus-visible:outline-none focus-visible:ring-0 sm:text-3xl',
      wide && 'col-span-2 aspect-auto',
      muted
        ? 'border-border bg-surface-2 text-text hover:border-primary/50 hover:bg-surface-3 active:bg-surface-3'
        : active
          ? 'border-primary-dark bg-primary-dark text-white shadow-md'
          : 'border-primary bg-primary text-white shadow-sm hover:bg-primary-dark active:bg-primary-dark'
    )}>{label}</button>
  )
}
