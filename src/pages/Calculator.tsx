import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  Divide,
  Equal,
  Minus,
  Percent,
  Plus,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { useCapital } from '../hooks/useCapital'
import { CURRENCIES } from '../lib/currency'

type Operator = '+' | '-' | '*' | '/'
type ExpressionToken = number | Operator
type PickerTarget = number | 'add' | null
type SavedCalculatorState = {
  activeRowIndex: number
  baseAmount: number | null
  input: string
  waitingForOperand: boolean
  expression: ExpressionToken[]
  operator: Operator | null
}

// CURRENCIES — єдине джерело списку, яке також використовують Огляд,
// Рахунки та Борги. Калькулятор не має окремого переліку валют.
const INITIAL_CURRENCIES = CURRENCIES.slice(0, 5) as unknown as string[]

const currencySet = new Set<string>(CURRENCIES)
const currenciesWithTwoDecimals = new Set(['UAH', 'USD', 'EUR', 'GBP', 'PLN'])
const CALCULATOR_STATE_KEY = 'findossar-calculator-state'

function isOperator(value: unknown): value is Operator {
  return value === '+' || value === '-' || value === '*' || value === '/'
}

function readSavedCalculatorState(): SavedCalculatorState | null {
  try {
    const saved = JSON.parse(localStorage.getItem(CALCULATOR_STATE_KEY) ?? 'null') as Record<string, unknown> | null
    if (!saved || typeof saved.input !== 'string' || typeof saved.waitingForOperand !== 'boolean') return null

    const expression = Array.isArray(saved.expression)
      ? saved.expression.filter((token): token is ExpressionToken =>
          (typeof token === 'number' && Number.isFinite(token)) || isOperator(token)
        )
      : []
    const activeRowIndex = typeof saved.activeRowIndex === 'number' && Number.isInteger(saved.activeRowIndex) && saved.activeRowIndex >= 0
      ? saved.activeRowIndex
      : 0
    const baseAmount = saved.baseAmount === null
      ? null
      : typeof saved.baseAmount === 'number' && Number.isFinite(saved.baseAmount)
        ? saved.baseAmount
        : null

    return {
      activeRowIndex,
      baseAmount,
      input: saved.input,
      waitingForOperand: saved.waitingForOperand,
      expression,
      operator: isOperator(saved.operator) ? saved.operator : null,
    }
  } catch {
    // Пошкоджений або недоступний localStorage не повинен блокувати калькулятор.
    return null
  }
}

function readSavedCurrencies() {
  try {
    const saved = JSON.parse(localStorage.getItem('findossar-calculator-currencies') ?? 'null')
    if (Array.isArray(saved)) {
      const valid = saved.filter((currency): currency is string => typeof currency === 'string' && currencySet.has(currency))
      // Повторювані валюти навмисні: різні рядки можуть використовувати
      // один і той самий ISO-код для незалежних розрахунків.
      if (valid.length >= 2) return valid.slice(0, 5)
    }
  } catch {
    // Приватний режим або пошкоджений запис не повинні блокувати калькулятор.
  }
  return [...INITIAL_CURRENCIES]
}

function parseInput(value: string) {
  const number = Number(value.replace(',', '.'))
  return Number.isFinite(number) ? number : 0
}

function roundNumber(value: number) {
  // Відсікаємо накопичення похибки IEEE-754, не обрізаючи звичайні дроби.
  return Number(value.toFixed(12))
}

function formatValue(value: number | null, currency?: string) {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: currency && currenciesWithTwoDecimals.has(currency) ? 2 : 8,
  }).format(value)
}

function formatInput(value: string) {
  return value.replace('.', ',')
}

function inputValue(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '0'
  return String(roundNumber(value))
}

function calculate(left: number, right: number, operator: Operator) {
  if (operator === '+') return roundNumber(left + right)
  if (operator === '-') return roundNumber(left - right)
  if (operator === '*') return roundNumber(left * right)
  if (right === 0) return null
  return roundNumber(left / right)
}

/** Обчислює повний вираз із пріоритетом ×/÷ над +/−. */
function evaluateExpression(tokens: ExpressionToken[]) {
  if (tokens.length === 0 || typeof tokens[0] !== 'number') return null

  const terms: number[] = [tokens[0]]
  const lowPriorityOperators: Operator[] = []

  for (let index = 1; index < tokens.length; index += 2) {
    const currentOperator = tokens[index]
    const right = tokens[index + 1]
    if (typeof currentOperator !== 'string' || typeof right !== 'number') return null

    if (currentOperator === '*' || currentOperator === '/') {
      const left = terms.pop()!
      const result = calculate(left, right, currentOperator)
      if (result === null) return null
      terms.push(result)
    } else {
      lowPriorityOperators.push(currentOperator)
      terms.push(right)
    }
  }

  let result = terms[0]
  for (let index = 0; index < lowPriorityOperators.length; index += 1) {
    const currentOperator = lowPriorityOperators[index]
    const right = terms[index + 1]
    result = currentOperator === '+' ? roundNumber(result + right) : roundNumber(result - right)
  }
  return Number.isFinite(result) ? result : null
}

function expressionLabel(tokens: ExpressionToken[], input: string, waitingForOperand: boolean, currency?: string) {
  const labels = tokens.map(token => {
    if (typeof token === 'number') return formatValue(token, currency)
    if (token === '*') return '×'
    if (token === '/') return '÷'
    return token
  })
  // The current operand is intentionally not added until it is complete; this
  // keeps `100 +` visible while the next number is being entered.
  if (!waitingForOperand) labels.push(formatInput(input))
  else if (labels.length === 0) labels.push(formatValue(parseInput(input), currency))
  return labels.join(' ')
}

export function Calculator() {
  const { ratesMap, baseCurrency, loading } = useCapital()
  const [savedState] = useState<SavedCalculatorState | null>(readSavedCalculatorState)
  const [currencies, setCurrencies] = useState<string[]>(readSavedCurrencies)
  const [activeRowIndex, setActiveRowIndex] = useState(savedState?.activeRowIndex ?? 0)
  const activeCurrency = currencies[activeRowIndex] ?? currencies[0] ?? 'UAH'
  // Base value is only for rendering equivalents. Arithmetic never uses it.
  const [baseAmount, setBaseAmount] = useState<number | null>(savedState ? savedState.baseAmount : 100)
  const [input, setInput] = useState(savedState?.input ?? '100')
  const [waitingForOperand, setWaitingForOperand] = useState(savedState?.waitingForOperand ?? true)
  const [expression, setExpression] = useState<ExpressionToken[]>(savedState?.expression ?? [])
  const [operator, setOperator] = useState<Operator | null>(savedState?.operator ?? null)
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null)
  const [error, setError] = useState<string | null>(null)
  const initialDisplayRef = useRef(savedState === null)

  const availableCurrencies = useMemo(
    () => currencies.length >= 5
      ? []
      : CURRENCIES.filter(currency => !currencies.includes(currency)),
    [currencies]
  )

  useEffect(() => {
    try {
      localStorage.setItem('findossar-calculator-currencies', JSON.stringify(currencies))
    } catch {
      // Калькулятор продовжує працювати без збереження між сесіями.
    }
  }, [currencies])

  useEffect(() => {
    try {
      localStorage.setItem(CALCULATOR_STATE_KEY, JSON.stringify({
        activeRowIndex,
        baseAmount,
        input,
        waitingForOperand,
        expression,
        operator,
      } satisfies SavedCalculatorState))
    } catch {
      // Калькулятор продовжує працювати без збереження між вкладками.
    }
  }, [activeRowIndex, baseAmount, input, waitingForOperand, expression, operator])

  // На калькуляторі мобільний екран фіксується і pinch-zoom вимикається.
  // Після виходу meta viewport повертається, щоб не змінювати інші вкладки.
  useEffect(() => {
    document.documentElement.classList.add('calculator-route')
    document.body.classList.add('calculator-route')
    const viewport = document.querySelector('meta[name="viewport"]')
    const previousViewport = viewport?.getAttribute('content')
    viewport?.setAttribute(
      'content',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
    )

    return () => {
      document.documentElement.classList.remove('calculator-route')
      document.body.classList.remove('calculator-route')
      if (viewport && previousViewport) viewport.setAttribute('content', previousViewport)
    }
  }, [])

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
    return roundNumber((amount * fromRate) / toRate)
  }

  useEffect(() => {
    if (currencies.length === 0 || activeRowIndex < currencies.length) return
    const nextIndex = Math.max(0, currencies.length - 1)
    const next = currencies[nextIndex] ?? 'UAH'
    setActiveRowIndex(nextIndex)
    setInput(inputValue(valueFor(next)))
    setWaitingForOperand(true)
  }, [activeRowIndex, currencies, baseAmount, baseCurrency, ratesMap])

  useEffect(() => {
    if (loading || !initialDisplayRef.current || !currencies.includes(activeCurrency)) return
    const current = valueFor(activeCurrency)
    if (current !== null) setInput(inputValue(current))
    initialDisplayRef.current = false
  }, [loading, currencies, activeCurrency, baseAmount, baseCurrency, ratesMap])

  const currentAmount = () => parseInput(input)

  const syncInputToBase = (value: string, currency = activeCurrency) => {
    const rate = rateToBase(currency)
    if (rate !== null) setBaseAmount(roundNumber(parseInput(value) * rate))
    else setBaseAmount(null)
  }

  const setActive = (currency: string, rowIndex = currencies.findIndex(item => item === currency)) => {
    initialDisplayRef.current = false
    if (currency !== activeCurrency && expression.length > 0) {
      const convertedExpression = expression.map(token => {
        if (typeof token === 'string') return token
        return convertBetween(token, activeCurrency, currency)
      })
      if (convertedExpression.some(token => typeof token !== 'string' && token === null)) {
        setError(`Немає курсу для переходу ${activeCurrency} → ${currency}`)
        return
      }
      setExpression(convertedExpression as ExpressionToken[])
    }

    if (rowIndex >= 0) setActiveRowIndex(rowIndex)
    setInput(inputValue(valueFor(currency)))
    setWaitingForOperand(true)
    setError(null)
  }

  const openPicker = (index: number, currency: string) => {
    setActive(currency, index)
    setPickerTarget(current => (current === index ? null : index))
  }

  const chooseCurrency = (currency: string) => {
    if (pickerTarget === 'add') {
      if (currencies.length >= 5) {
        setPickerTarget(null)
        return
      }
      setCurrencies(current => (
        current.length >= 5 || current.includes(currency)
          ? current
          : [...current, currency]
      ))
      setActive(currency, currencies.length)
      setPickerTarget(null)
      return
    }

    if (typeof pickerTarget === 'number') {
      const rowIndex = pickerTarget
      const replaced = currencies[rowIndex]
      if (!replaced) {
        setPickerTarget(null)
        return
      }
      if (currency === replaced) {
        removeCurrency(rowIndex)
        return
      }
      setCurrencies(current => current.map((item, index) => (index === rowIndex ? currency : item)))
      if (activeRowIndex === rowIndex) setActive(currency, rowIndex)
      setPickerTarget(null)
    }
  }

  const removeCurrency = (index: number) => {
    if (currencies.length <= 2) {
      setPickerTarget(null)
      return
    }
    const removedCurrency = currencies[index]
    if (!removedCurrency) return
    const nextCurrencies = currencies.filter((_, itemIndex) => itemIndex !== index)
    setCurrencies(nextCurrencies)
    if (activeRowIndex === index) {
      const nextIndex = Math.min(index, nextCurrencies.length - 1)
      const nextCurrency = nextCurrencies[nextIndex] ?? 'UAH'
      setActive(nextCurrency, nextIndex)
    } else if (activeRowIndex > index) {
      setActiveRowIndex(activeRowIndex - 1)
    }
    setPickerTarget(null)
  }

  const appendInput = (token: string) => {
    initialDisplayRef.current = false
    setError(null)
    const current = waitingForOperand ? '' : input
    if (token === '.' && current.includes('.')) return
    const next = current === ''
      ? (token === '.' ? '0.' : token)
      : current === '0' && token !== '.'
        ? token
        : `${current}${token}`
    setInput(next)
    setWaitingForOperand(false)
    syncInputToBase(next)
  }

  const clear = () => {
    initialDisplayRef.current = false
    setInput('0')
    setBaseAmount(0)
    setExpression([])
    setOperator(null)
    setWaitingForOperand(true)
    setError(null)
  }

  const backspace = () => {
    initialDisplayRef.current = false
    if (waitingForOperand) {
      setInput('0')
      syncInputToBase('0')
      return
    }
    const next = input.length > 1 ? input.slice(0, -1) : '0'
    setInput(next)
    syncInputToBase(next)
  }

  const chooseOperator = (nextOperator: Operator) => {
    initialDisplayRef.current = false
    setError(null)
    const current = currentAmount()
    const lastToken = expression[expression.length - 1]

    if (expression.length === 0) {
      setExpression([current, nextOperator])
    } else if (typeof lastToken === 'string' && waitingForOperand) {
      // If no next operand has been entered yet, changing the operator replaces it.
      setExpression([...expression.slice(0, -1), nextOperator])
    } else {
      // Once the operand is entered, keep it and append the next operator so the
      // full expression (for example `100 + 100 +`) remains editable until `=`.
      setExpression([...expression, current, nextOperator])
    }
    setOperator(nextOperator)
    setWaitingForOperand(true)
  }

  const equals = () => {
    initialDisplayRef.current = false
    if (expression.length === 0) return
    const lastToken = expression[expression.length - 1]
    const tokens = typeof lastToken === 'string' ? [...expression, currentAmount()] : expression
    if (tokens.length < 3) return
    const result = evaluateExpression(tokens)
    if (result === null) {
      setError('Неможливо поділити на нуль')
      return
    }
    const rate = rateToBase(activeCurrency)
    setBaseAmount(rate === null ? null : roundNumber(result * rate))
    setInput(inputValue(result))
    setExpression([])
    setOperator(null)
    setWaitingForOperand(true)
  }

  const percent = () => {
    initialDisplayRef.current = false
    const current = currentAmount()
    const previousToken = expression.length >= 2 ? expression[expression.length - 2] : null
    const previousOperator = typeof previousToken === 'string' ? previousToken : null
    const previousNumber = expression.length >= 2 && typeof expression[expression.length - 2] === 'number'
      ? expression[expression.length - 2] as number
      : null
    // For +/− use a percentage of the previous operand (100 + 10% = 110).
    // For ×/÷, the percentage is the entered number divided by 100.
    const result = previousNumber !== null && (previousOperator === '+' || previousOperator === '-')
      ? roundNumber((previousNumber * current) / 100)
      : roundNumber(current / 100)
    setInput(inputValue(result))
    setWaitingForOperand(false)
    syncInputToBase(inputValue(result))
  }

  // Screen buttons and a physical keyboard intentionally call the same
  // handlers, so both input methods have identical calculator behavior.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      const key = event.key
      if (/^[0-9]$/.test(key)) {
        event.preventDefault()
        appendInput(key)
      } else if (key === '.' || key === ',') {
        event.preventDefault()
        appendInput('.')
      } else if (key === 'ArrowUp' || key === 'ArrowDown') {
        // Keep row navigation independent from calculator arithmetic. The
        // modulo makes the selection wrap from the first row to the last (and
        // vice versa) on every keyboard layout and operating system.
        event.preventDefault()
        if (currencies.length === 0) return
        const direction = key === 'ArrowUp' ? -1 : 1
        const nextIndex = (activeRowIndex + direction + currencies.length) % currencies.length
        const nextCurrency = currencies[nextIndex]
        if (nextCurrency) setActive(nextCurrency, nextIndex)
      } else if (key === '+' || key === '-' || key === '*' || key === '/') {
        event.preventDefault()
        chooseOperator(key)
      } else if (key === 'Enter' || key === '=') {
        event.preventDefault()
        equals()
      } else if (key === 'Backspace') {
        event.preventDefault()
        backspace()
      } else if (key === 'Escape' || key === 'Delete' || key.toLowerCase() === 'c') {
        event.preventDefault()
        clear()
      } else if (key === '%') {
        event.preventDefault()
        percent()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [input, waitingForOperand, expression, operator, activeCurrency, activeRowIndex, currencies, baseCurrency, ratesMap])

  const missingRates = currencies.filter(currency => rateToBase(currency) === null)

  return (
    <section className="calculator-screen mx-auto flex min-h-[calc(100dvh-10rem)] w-full max-w-2xl flex-col gap-3 pb-2">
      <div className="calculator-upper flex min-h-0 flex-col gap-3">
        <div className="calculator-currency-list flex flex-col gap-3">
          {currencies.map((currency, index) => {
            const selected = activeRowIndex === index
            const amount = selected ? currentAmount() : valueFor(currency)
            return (
              <div key={`${currency}-${index}`} className="calculator-currency-row relative grid grid-cols-[minmax(106px,0.9fr)_minmax(0,3.2fr)] gap-3">
                <div
                  className={clsx(
                    'calculator-currency-side flex min-h-[64px] items-center gap-2 rounded-[1.25rem] border bg-surface-2 px-3 shadow-sm transition-colors',
                    selected ? 'border-primary/70 calculator-selected-control' : 'border-border'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => openPicker(index, currency)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
                    aria-label={`Вибрати валюту ${currency}`}
                  >
                    <span className="truncate text-sm font-extrabold text-text">{currency}</span>
                    <ChevronDown size={14} className="ml-auto shrink-0 text-text-muted" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setActive(currency, index)}
                  className={clsx(
                    'calculator-currency-value min-h-[64px] rounded-[1.25rem] border px-4 text-right text-2xl font-bold tabular-nums outline-none transition-colors sm:text-3xl',
                    selected
                      ? 'border-primary bg-primary/10 text-primary shadow-sm calculator-selected-control'
                      : 'border-border bg-surface-2 text-text hover:border-primary/50'
                  )}
                  aria-label={`Ввести суму у ${currency}`}
                >
                  {selected && !waitingForOperand ? formatInput(input) : formatValue(amount, currency)}
                </button>

                {pickerTarget === index && (
                  <CurrencyPicker
                    options={CURRENCIES}
                    selected={currency}
                    onSelect={chooseCurrency}
                    onClose={() => setPickerTarget(null)}
                    title="Валюта або криптовалюта"
                  />
                )}
              </div>
            )
          })}
        </div>

        <div className="calculator-add-wrap relative">
          {availableCurrencies.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setPickerTarget(current => (current === 'add' ? null : 'add'))}
                className="calculator-add flex min-h-10 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface/70 px-3 text-sm font-semibold text-text-muted transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
              >
                <Plus size={16} /> Додати валюту або криптовалюту
              </button>
              {pickerTarget === 'add' && (
                <CurrencyPicker
                  options={availableCurrencies}
                  onSelect={chooseCurrency}
                  onClose={() => setPickerTarget(null)}
                  title="Додати рядок"
                  wide
                />
              )}
            </>
          )}
          {missingRates.length > 0 && (
            <p className="calculator-rate-note mt-2 text-center text-[11px] text-text-muted">
              Для {missingRates.join(', ')} ще немає курсу — їх еквівалент буде доступний після налаштування курсу.
            </p>
          )}
        </div>

        {error && <p className="calculator-error text-center text-xs font-semibold text-danger">{error}</p>}
      </div>

      <div
        className="calculator-expression min-h-8 rounded-xl border border-border bg-surface/70 px-3 py-1.5 text-right text-sm font-semibold tabular-nums text-text-muted"
        aria-live="polite"
        aria-label="Поточний математичний вираз"
      >
        {expressionLabel(expression, input, waitingForOperand, activeCurrency)}
      </div>

      <div className="calculator-keypad mt-auto grid grid-cols-4 gap-3 pb-1 pt-1">
        <CalcButton label="C" onClick={clear} muted />
        <CalcButton label={<ArrowLeft size={25} />} onClick={backspace} muted ariaLabel="Видалити останню цифру" />
        <CalcButton label={<Percent size={23} />} onClick={percent} muted ariaLabel="Відсоток" />
        <CalcButton label={<Divide size={24} />} onClick={() => chooseOperator('/')} active={operator === '/'} />

        <CalcButton label="7" onClick={() => appendInput('7')} muted />
        <CalcButton label="8" onClick={() => appendInput('8')} muted />
        <CalcButton label="9" onClick={() => appendInput('9')} muted />
        <CalcButton label="×" onClick={() => chooseOperator('*')} active={operator === '*'} />

        <CalcButton label="4" onClick={() => appendInput('4')} muted />
        <CalcButton label="5" onClick={() => appendInput('5')} muted />
        <CalcButton label="6" onClick={() => appendInput('6')} muted />
        <CalcButton label={<Minus size={24} />} onClick={() => chooseOperator('-')} active={operator === '-'} />

        <CalcButton label="1" onClick={() => appendInput('1')} muted />
        <CalcButton label="2" onClick={() => appendInput('2')} muted />
        <CalcButton label="3" onClick={() => appendInput('3')} muted />
        <CalcButton label={<Plus size={24} />} onClick={() => chooseOperator('+')} active={operator === '+'} />

        <CalcButton label="0" onClick={() => appendInput('0')} muted wide />
        <CalcButton label="," onClick={() => appendInput('.')} muted />
        <CalcButton label={<Equal size={24} />} onClick={equals} />
      </div>
    </section>
  )
}

function CurrencyPicker({
  options,
  selected,
  onSelect,
  onClose,
  title,
  wide = false,
}: {
  options: readonly string[]
  selected?: string
  onSelect: (currency: string) => void
  onClose: () => void
  title: string
  wide?: boolean
}) {
  return (
    <div className={clsx('absolute left-0 top-[calc(100%+0.5rem)] z-30 rounded-2xl border border-border bg-surface p-3 shadow-xl', wide ? 'inset-x-0' : 'w-full')}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-text-muted">{title}</span>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-text-muted hover:bg-surface-2" aria-label="Закрити список">
          <X size={15} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {options.map(currency => {
          return (
            <button
              key={currency}
              type="button"
              onClick={() => onSelect(currency)}
              className={clsx(
                'flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs font-bold transition-colors hover:bg-surface-2',
                currency === selected ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text'
              )}
            >
              <span>{currency}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CalcButton({
  label,
  onClick,
  muted = false,
  active = false,
  wide = false,
  ariaLabel,
}: {
  label: React.ReactNode
  onClick: () => void
  muted?: boolean
  active?: boolean
  wide?: boolean
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={clsx(
        'calculator-key flex aspect-square items-center justify-center rounded-[1.5rem] border text-2xl font-bold outline-none transition-colors active:scale-[0.98] sm:text-3xl',
        wide && 'col-span-2 aspect-auto',
        muted
          ? 'border-border bg-surface-2 text-text hover:border-primary/50 hover:bg-surface-3'
          : active
            ? 'border-primary-dark bg-primary-dark text-white shadow-md ring-2 ring-primary/30'
            : 'border-primary bg-primary text-white shadow-sm hover:bg-primary-dark'
      )}
    >
      {label}
    </button>
  )
}
