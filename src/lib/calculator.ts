export type CalculatorOperator = '+' | '-' | '*' | '/'

const OPERATORS = new Set<CalculatorOperator>(['+', '-', '*', '/'])

export function isCalculatorOperator(value: string): value is CalculatorOperator {
  return OPERATORS.has(value as CalculatorOperator)
}

export function roundCalculatorNumber(value: number) {
  return Number(value.toFixed(12))
}

export function calculatorNumber(value: number) {
  return String(roundCalculatorNumber(value))
}

/** Converts pasted/displayed symbols to the compact expression format used in state. */
export function normalizeCalculatorExpression(value: string) {
  return value
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/,/g, '.')
    .replace(/\s+/g, '')
    .replace(/[^0-9.+\-*/()]/g, '')
}

/** Human-readable expression without changing its editable source value. */
export function formatCalculatorExpression(value: string) {
  const source = normalizeCalculatorExpression(value)
  let result = ''

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '.') {
      result += ','
      continue
    }
    if (character === '(') {
      result += result && !result.endsWith(' ') ? ' (' : '('
      continue
    }
    if (character === ')') {
      result = result.trimEnd() + ')'
      continue
    }
    if (isCalculatorOperator(character)) {
      const previous = source[index - 1]
      const unary = (character === '+' || character === '-') && (index === 0 || previous === '(' || isCalculatorOperator(previous))
      result += unary ? character : ` ${character === '*' ? '×' : character === '/' ? '÷' : character} `
      continue
    }
    result += character
  }

  return result.replace(/\s+/g, ' ').trim()
}

class ExpressionParser {
  private index = 0
  private readonly source: string

  constructor(source: string) {
    this.source = source
  }

  parse() {
    if (!this.source) return null
    const value = this.parseSum()
    if (value === null || this.index !== this.source.length || !Number.isFinite(value)) return null
    return roundCalculatorNumber(value)
  }

  private parseSum(): number | null {
    let value = this.parseProduct()
    if (value === null) return null

    while (this.peek() === '+' || this.peek() === '-') {
      const operator = this.source[this.index++] as '+' | '-'
      const right = this.parseProduct()
      if (right === null) return null
      value = roundCalculatorNumber(operator === '+' ? value + right : value - right)
    }

    return value
  }

  private parseProduct(): number | null {
    let value = this.parseUnary()
    if (value === null) return null

    while (this.peek() === '*' || this.peek() === '/') {
      const operator = this.source[this.index++] as '*' | '/'
      const right = this.parseUnary()
      if (right === null || (operator === '/' && right === 0)) return null
      value = roundCalculatorNumber(operator === '*' ? value * right : value / right)
    }

    return value
  }

  private parseUnary(): number | null {
    if (this.peek() === '+') {
      this.index += 1
      return this.parseUnary()
    }
    if (this.peek() === '-') {
      this.index += 1
      const value = this.parseUnary()
      return value === null ? null : roundCalculatorNumber(-value)
    }
    return this.parsePrimary()
  }

  private parsePrimary(): number | null {
    if (this.peek() === '(') {
      this.index += 1
      const value = this.parseSum()
      if (value === null || this.peek() !== ')') return null
      this.index += 1
      return value
    }

    const rest = this.source.slice(this.index)
    const match = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)/)
    if (!match) return null
    this.index += match[0].length
    const value = Number(match[0])
    return Number.isFinite(value) ? value : null
  }

  private peek() {
    return this.source[this.index]
  }
}

/** Safe recursive-descent evaluator: no eval/Function and normal operator precedence. */
export function evaluateCalculatorExpression(value: string) {
  return new ExpressionParser(normalizeCalculatorExpression(value)).parse()
}

export function trailingNumberLiteral(value: string) {
  return normalizeCalculatorExpression(value).match(/(?:\d+(?:\.\d*)?|\.\d+)$/)?.[0] ?? null
}

export function lastNumberLiteral(value: string) {
  const matches = normalizeCalculatorExpression(value).match(/(?:\d+(?:\.\d*)?|\.\d+)/g)
  return matches ? matches[matches.length - 1] : null
}

export function replaceTrailingNumber(value: string, replacement: string) {
  const source = normalizeCalculatorExpression(value)
  return source.replace(/(?:\d+(?:\.\d*)?|\.\d+)$/, normalizeCalculatorExpression(replacement))
}

/** Converts every amount in an expression when the active currency changes. */
export function convertCalculatorExpression(
  value: string,
  converter: (amount: number) => number | null
) {
  let failed = false
  const converted = normalizeCalculatorExpression(value).replace(/(?:\d+(?:\.\d*)?|\.\d+)/g, literal => {
    const result = converter(Number(literal))
    if (result === null || !Number.isFinite(result)) {
      failed = true
      return literal
    }
    return calculatorNumber(result)
  })
  return failed ? null : converted
}

export function unmatchedOpeningParentheses(value: string) {
  let count = 0
  for (const character of normalizeCalculatorExpression(value)) {
    if (character === '(') count += 1
    else if (character === ')') count = Math.max(0, count - 1)
  }
  return count
}
