import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { translations, type Language } from '../../shared/i18n.ts';

export async function initI18n(language: Language): Promise<void> {
  await i18next.use(initReactI18next).init({
    resources: {
      en: { translation: translations.en },
      de: { translation: translations.de },
    },
    lng: language,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  document.documentElement.lang = language;
}

export async function changeLanguage(language: Language): Promise<void> {
  await i18next.changeLanguage(language);
  document.documentElement.lang = language;
}

export const t = (key: string, options?: Record<string, unknown>): string => i18next.t(key, options);
