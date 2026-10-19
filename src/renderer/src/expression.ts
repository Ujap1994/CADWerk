/**
 * Arithmetic typed into number fields and dimension values: + − × ÷ (also * and /), powers (^),
 * parentheses, π (pi), sqrt, abs and the trigonometric functions in degrees; a number or a bracket
 * may carry a length unit (mm, cm, m, in, "), which converts it to millimeters. Both "." and "," are
 * decimal separators, because German users naturally type a comma. Nothing is ever evaluated as code.
 */

const UNITS: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, '"': 25.4 };
const DEGREES = Math.PI / 180;
const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: (x) => Math.sin(x * DEGREES),
  cos: (x) => Math.cos(x * DEGREES),
  tan: (x) => Math.tan(x * DEGREES),
};
const OPERATORS: Record<string, string> = { '×': '*', '·': '*', '÷': '/', '−': '-' };

type Token = { kind: 'number'; value: number } | { kind: 'name'; value: string } | { kind: 'symbol'; value: string };

function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i] as string;
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    const number = /^(\d+([.,]\d*)?|[.,]\d+)/.exec(text.slice(i));
    if (number) {
      tokens.push({ kind: 'number', value: Number(number[0].replace(',', '.')) });
      i += number[0].length;
      continue;
    }
    const name = /^[a-zA-Zπ]+/.exec(text.slice(i));
    if (name) {
      tokens.push({ kind: 'name', value: name[0].toLowerCase() });
      i += name[0].length;
      continue;
    }
    const symbol = OPERATORS[char] ?? char;
    if (!'+-*/^()"'.includes(symbol)) return null;
    tokens.push({ kind: 'symbol', value: symbol });
    i++;
  }
  return tokens;
}

/** The value of an expression, or null if it is not one (or not a finite number). */
export function evaluate(text: string): number | null {
  const tokens = tokenize(text);
  if (!tokens || tokens.length === 0) return null;
  let position = 0;
  const peek = () => tokens[position];
  const isSymbol = (value: string) => {
    const token = peek();
    return token?.kind === 'symbol' && token.value === value;
  };
  const fail = (): never => {
    throw new SyntaxError('invalid expression');
  };

  /** An optional unit after a number or a closing bracket. */
  const unit = (value: number): number => {
    const token = peek();
    if (token?.kind === 'symbol' && token.value === '"') {
      position++;
      return value * 25.4;
    }
    if (token?.kind === 'name' && token.value in UNITS) {
      position++;
      return value * (UNITS[token.value] as number);
    }
    return value;
  };
  const primary = (): number => {
    const token = peek();
    if (!token) return fail();
    position++;
    if (token.kind === 'number') return unit(token.value);
    if (token.kind === 'symbol' && token.value === '(') {
      const value = sum();
      if (!isSymbol(')')) fail();
      position++;
      return unit(value);
    }
    if (token.kind === 'name') {
      if (token.value === 'pi' || token.value === 'π') return Math.PI;
      const fn = FUNCTIONS[token.value];
      if (fn && isSymbol('(')) {
        position++;
        const value = sum();
        if (!isSymbol(')')) fail();
        position++;
        return fn(value);
      }
    }
    return fail();
  };
  const unary = (): number => {
    if (isSymbol('-')) {
      position++;
      return -unary();
    }
    if (isSymbol('+')) {
      position++;
      return unary();
    }
    return power();
  };
  const power = (): number => {
    const base = primary();
    if (!isSymbol('^')) return base;
    position++;
    return base ** unary();
  };
  const product = (): number => {
    let value = unary();
    while (isSymbol('*') || isSymbol('/')) {
      const divide = isSymbol('/');
      position++;
      const right = unary();
      value = divide ? value / right : value * right;
    }
    return value;
  };
  function sum(): number {
    let value = product();
    while (isSymbol('+') || isSymbol('-')) {
      const minus = isSymbol('-');
      position++;
      const right = product();
      value = minus ? value - right : value + right;
    }
    return value;
  }

  try {
    const value = sum();
    if (position !== tokens.length) return null;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
