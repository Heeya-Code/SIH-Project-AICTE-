import { useState, useEffect, useRef, useCallback } from 'react';
import { Globe } from 'lucide-react';
import { ALL_LANGUAGES, ENGLISH, loadLocale, type Language } from './languages';
import { applyTranslation, getCurrentLang } from './translator';

const LS_KEY = 'approvalflow-lang';

/** Check which languages have locale files available (complete). */
let availableCache: Language[] | null = null;
async function getAvailableLanguages(): Promise<Language[]> {
  if (availableCache) return availableCache;
  const available: Language[] = [];
  for (const lang of ALL_LANGUAGES) {
    try {
      const dict = await import(`./locales/${lang.code}.json`);
      const keys = Object.keys(dict.default ?? dict);
      if (keys.length > 0) available.push(lang);
    } catch {
      // locale file doesn't exist or is invalid — skip
    }
  }
  availableCache = available;
  return available;
}

export function useLanguage() {
  const [lang, setLangState] = useState<string>(() => {
    try { return localStorage.getItem(LS_KEY) ?? 'en'; } catch { return 'en'; }
  });

  const setLang = useCallback(async (code: string) => {
    try { localStorage.setItem(LS_KEY, code); } catch { /* quota exceeded */ }
    setLangState(code);

    if (code === 'en') {
      applyTranslation('en', null);
    } else {
      try {
        const dict = await loadLocale(code);
        applyTranslation(code, dict);
      } catch {
        // Failed to load — fall back to English
        applyTranslation('en', null);
      }
    }
  }, []);

  // Apply saved language on mount (and after React renders new content)
  useEffect(() => {
    if (lang !== 'en') {
      loadLocale(lang)
        .then(dict => applyTranslation(lang, dict))
        .catch(() => applyTranslation('en', null));
    }
  }, [lang]);

  return { lang, setLang };
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<Language[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    getAvailableLanguages().then(setAvailable);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      btnRef.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
      if (!items?.length) return;
      const arr = Array.from(items);
      const idx = arr.findIndex(el => el === document.activeElement);
      const next = e.key === 'ArrowDown'
        ? (idx + 1) % arr.length
        : (idx - 1 + arr.length) % arr.length;
      arr[next].focus();
    }
  }, []);

  const allLangs: Language[] = [ENGLISH, ...available];
  const current = allLangs.find(l => l.code === lang) ?? ENGLISH;

  // Don't render if no translations are available
  if (available.length === 0) return null;

  return (
    <div ref={ref} className={`relative ${className ?? ''}`} data-no-translate>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        className="flex h-10 w-10 sm:w-auto sm:px-3 items-center justify-center gap-1.5 rounded-[10px] border border-[#E2E8F0] bg-white text-[#475569] hover:bg-[#F5F7FB] hover:text-[#0F172A] transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Language: ${current.englishName}. Change language.`}
        title="Change language"
      >
        <Globe className="h-5 w-5 shrink-0" aria-hidden />
        <span className="hidden sm:inline text-sm font-medium truncate max-w-[80px]">
          {current.nativeName}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Select language"
          className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-xl border border-[#E2E8F0] bg-white py-1.5 shadow-lg"
          onKeyDown={handleKeyDown}
        >
          <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#566579]">
            Language
          </p>
          {allLangs.map(l => (
            <button
              key={l.code}
              role="menuitemradio"
              aria-checked={l.code === lang}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[#F5F7FB] focus:bg-[#F5F7FB] focus:outline-none ${l.code === lang ? 'font-semibold text-[#2F5BEA]' : 'text-[#0F172A]'}`}
              onClick={() => { setLang(l.code); setOpen(false); }}
            >
              <span className="flex-1">{l.nativeName}</span>
              <span className="text-xs text-[#94A3B8]">{l.englishName}</span>
              {l.code === lang && (
                <svg className="h-4 w-4 shrink-0 text-[#2F5BEA]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
          <div className="mx-3 mt-1.5 border-t border-[#E2E8F0] pt-1.5">
            <p className="px-0 py-1 text-[11px] text-[#94A3B8] leading-tight">
              Translations are machine-assisted. English is the official version.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
