import { describe, expect, it } from 'vitest';
import { resolveLanguage, translate, translations } from '../../src/shared/i18n.ts';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/shared/settings.ts';

function keys(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node).flatMap(([key, value]) => keys(value, prefix ? `${prefix}.${key}` : key));
}

describe('settings', () => {
  it('falls back to defaults for missing or invalid values', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ language: 'fr', theme: 'dark', showFrameStats: 'yes', extra: 1 })).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' });
  });

  it('keeps valid values', () => {
    const custom = { language: 'de', theme: 'light', navigation: 'trackpad', projection: 'perspective', showFrameStats: true } as const;
    expect(sanitizeSettings(custom)).toEqual(custom);
  });
});

describe('languages', () => {
  it('resolves the system language with English as fallback', () => {
    expect(resolveLanguage('system', 'de-DE')).toBe('de');
    expect(resolveLanguage('system', 'de_AT')).toBe('de');
    expect(resolveLanguage('system', 'en-US')).toBe('en');
    expect(resolveLanguage('system', 'fr-FR')).toBe('en');
    expect(resolveLanguage('de', 'en-US')).toBe('de');
  });

  it('has the same keys in English and German', () => {
    expect(keys(translations.de).sort()).toEqual(keys(translations.en).sort());
  });

  it('has no empty translations', () => {
    for (const language of ['en', 'de'] as const) {
      for (const key of keys(translations[language])) expect(translate(language, key), `${language}:${key}`).not.toBe('');
    }
  });

  it('interpolates values and falls back to the key', () => {
    expect(translate('en', 'about.version', { version: '1.0' })).toBe('Version 1.0');
    expect(translate('de', 'does.not.exist')).toBe('does.not.exist');
  });
});
