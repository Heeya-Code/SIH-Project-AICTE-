/**
 * Supported languages for the ApprovalFlow multi-language UI.
 * Only languages whose locale file passes the i18n checker appear in the switcher.
 */

export interface Language {
  /** BCP-47 language code */
  code: string;
  /** Name in native script */
  nativeName: string;
  /** English name */
  englishName: string;
}

/** Batch 1 */
const BATCH_1: Language[] = [
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi' },
  { code: 'mr', nativeName: 'मराठी', englishName: 'Marathi' },
  { code: 'ta', nativeName: 'தமிழ்', englishName: 'Tamil' },
  { code: 'bn', nativeName: 'বাংলা', englishName: 'Bengali' },
];

/** Batch 2 */
const BATCH_2: Language[] = [
  { code: 'gu', nativeName: 'ગુજરાતી', englishName: 'Gujarati' },
  { code: 'te', nativeName: 'తెలుగు', englishName: 'Telugu' },
  { code: 'kn', nativeName: 'ಕನ್ನಡ', englishName: 'Kannada' },
  { code: 'ml', nativeName: 'മലയാളം', englishName: 'Malayalam' },
  { code: 'pa', nativeName: 'ਪੰਜਾਬੀ', englishName: 'Punjabi' },
  { code: 'or', nativeName: 'ଓଡ଼ିଆ', englishName: 'Odia' },
];

/** English (always available, not in the locale files) */
export const ENGLISH: Language = { code: 'en', nativeName: 'English', englishName: 'English' };

/** All translatable languages (batches 1 and 2) */
export const ALL_LANGUAGES: Language[] = [...BATCH_1, ...BATCH_2];

/** Load a locale file by language code. Returns a flat map of normalised English → translation. */
export async function loadLocale(code: string): Promise<Record<string, string>> {
  // Dynamic import so only the selected language is bundled/loaded
  const mod = await import(`./locales/${code}.json`);
  return mod.default ?? mod;
}
