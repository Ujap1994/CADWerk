import type { Language } from '../../shared/i18n.ts';
import { evaluate } from './expression.ts';

/**
 * Parses a number typed by the user: a plain number with either decimal separator ("2.5" and "2,5",
 * because German users naturally type a comma) or a calculation such as "60/3 + 2" or "1in"
 * (see expression.ts).
 */
export function parseNumber(text: string): number | null {
  return evaluate(text);
}

export function formatNumber(value: number, language: Language, maximumFractionDigits = 3): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits, useGrouping: false }).format(value);
}

export function formatQuantity(value: number, language: Language, unit: string, maximumFractionDigits = 2): string {
  const formatted = new Intl.NumberFormat(language, { maximumFractionDigits, useGrouping: true }).format(value);
  return `${formatted} ${unit}`;
}
