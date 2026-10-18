import type { LanguageSetting } from './settings.ts';
import en from './locales/en.json' with { type: 'json' };
import de from './locales/de.json' with { type: 'json' };

export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const translations: Record<Language, typeof en> = { en, de };

/** Resolves the language setting; "system" follows the OS locale and falls back to English. */
export function resolveLanguage(setting: LanguageSetting, systemLocale: string): Language {
  if (setting !== 'system') return setting;
  const primary = systemLocale.toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary ?? '') ? (primary as Language) : 'en';
}

/** Minimal lookup for the main process (the renderer uses i18next with the same dictionaries). */
export function translate(language: Language, key: string, values: Record<string, string> = {}): string {
  const lookup = (dict: unknown): string | undefined => {
    let node: unknown = dict;
    for (const part of key.split('.')) {
      if (typeof node !== 'object' || node === null) return undefined;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string' ? node : undefined;
  };
  const text = lookup(translations[language]) ?? lookup(translations.en) ?? key;
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? '');
}
