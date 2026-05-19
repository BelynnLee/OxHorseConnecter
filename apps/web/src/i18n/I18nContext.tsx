import { createContext, useContext, useState, type ReactNode } from 'react';
import en from './locales/en.ts';
import zh from './locales/zh.ts';
import zhTw from './locales/zh-TW.ts';
import type { Translations } from './locales/en.ts';

export const SUPPORTED_LOCALES = ['en', 'zh', 'zh-TW'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS = {
  en: { label: 'English', short: 'EN' },
  zh: { label: '\u7b80\u4f53\u4e2d\u6587', short: '\u7b80\u4e2d' },
  'zh-TW': { label: '\u7e41\u9ad4\u4e2d\u6587', short: '\u7e41\u4e2d' },
} satisfies Record<Locale, { label: string; short: string }>;

export const LOCALES = { en, zh, 'zh-TW': zhTw } satisfies Record<Locale, Translations>;
const STORAGE_KEY = 'rac_locale';

function isLocale(value: string | null): value is Locale {
  return value === 'en' || value === 'zh' || value === 'zh-TW';
}

function detectLocaleFromLanguageTag(value: string | undefined): Locale | null {
  if (!value) return null;
  const tag = value.toLowerCase().replace(/_/g, '-');
  if (tag === 'zh-tw' || tag === 'zh-hant' || tag === 'zh-hk' || tag === 'zh-mo') return 'zh-TW';
  if (tag.startsWith('zh-tw-') || tag.startsWith('zh-hant-') || tag.startsWith('zh-hk-') || tag.startsWith('zh-mo-')) {
    return 'zh-TW';
  }
  if (tag === 'zh' || tag === 'zh-cn' || tag === 'zh-sg' || tag === 'zh-hans') return 'zh';
  if (tag.startsWith('zh-cn-') || tag.startsWith('zh-sg-') || tag.startsWith('zh-hans-')) return 'zh';
  if (tag.startsWith('zh-')) return 'zh';
  if (tag === 'en' || tag.startsWith('en-')) return 'en';
  return null;
}

function getInitialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (isLocale(stored)) return stored;

  const languageTags = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  for (const language of languageTags) {
    const detected = detectLocaleFromLanguageTag(language);
    if (detected) return detected;
  }
  return 'en';
}

interface I18nContextValue {
  locale: Locale;
  t: Translations;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  function setLocale(next: Locale) {
    localStorage.setItem(STORAGE_KEY, next);
    setLocaleState(next);
  }

  return (
    <I18nContext.Provider value={{ locale, t: LOCALES[locale], setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used inside I18nProvider');
  return ctx;
}
