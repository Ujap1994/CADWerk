import type { Language } from '../../shared/i18n.ts';

/**
 * Parses a length typed by the user. Accepts both decimal separators
 * ("2.5" and "2,5") because German users naturally type a comma.
 */
export function parseNumber(text: string): number | null {
  const normalized = text.trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function formatNumber(value: number, language: Language, maximumFractionDigits = 3): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits, useGrouping: false }).format(value);
}

export function formatQuantity(value: number, language: Language, unit: string, maximumFractionDigits = 2): string {
  const formatted = new Intl.NumberFormat(language, { maximumFractionDigits, useGrouping: true }).format(value);
  return `${formatted} ${unit}`;
}
