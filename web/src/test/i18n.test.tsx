import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { normalise, restoreTokens, applyTranslation, getCurrentLang, destroy } from '../i18n/translator';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import { ALL_LANGUAGES, ENGLISH } from '../i18n/languages';
import { GLOSSARY_SET } from '../i18n/glossary';

describe('i18n: Normalisation and Token Replacement', () => {
  it('normalises plain strings without tokens', () => {
    const result = normalise('Sign in to portal');
    expect(result.key).toBe('Sign in to portal');
    expect(result.tokens).toEqual([]);
  });

  it('normalises numbers into placeholders', () => {
    const result = normalise('Due within 3 days');
    expect(result.key).toBe('Due within {0} days');
    expect(result.tokens).toEqual(['3']);

    const restored = restoreTokens('{0} दिनों के भीतर देय', result.tokens);
    expect(restored).toBe('3 दिनों के भीतर देय');
  });

  it('normalises reference codes, dates, and currency', () => {
    const resRef = normalise('Application AF-2026-00001 created');
    expect(resRef.tokens).toContain('AF-2026-00001');

    const resCurr = normalise('Fee is ₹1,23,456');
    expect(resCurr.tokens).toContain('₹1,23,456');

    const resEmail = normalise('Contact inst1@demo.local for help');
    expect(resEmail.tokens).toContain('inst1@demo.local');
  });

  it('restores tokens properly with restoreTokens', () => {
    const tokens = ['5', '10'];
    expect(restoreTokens('Page {0} of {1}', tokens)).toBe('Page 5 of 10');
    expect(restoreTokens('{0} results found out of {1}', tokens)).toBe('5 results found out of 10');
  });
});

describe('i18n: DOM Translator', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
  });

  afterEach(() => {
    destroy();
    container.remove();
    document.documentElement.lang = 'en';
  });

  it('translates text nodes and restores English on reset', () => {
    container.innerHTML = `
      <div id="test-content">
        <h1>Sign in to portal</h1>
        <p>Institution</p>
      </div>
    `;

    const dict = {
      'Sign in to portal': 'पोर्टल में साइन इन करें',
      'Institution': 'संस्थान',
    };

    applyTranslation('hi', dict);
    expect(document.documentElement.lang).toBe('hi');
    expect(getCurrentLang()).toBe('hi');

    const h1 = container.querySelector('h1')!;
    const p = container.querySelector('p')!;
    expect(h1.textContent).toBe('पोर्टल में साइन इन करें');
    expect(p.textContent).toBe('संस्थान');

    // Restore English
    applyTranslation('en', null);
    expect(document.documentElement.lang).toBe('en');
    expect(getCurrentLang()).toBe('en');
    expect(h1.textContent).toBe('Sign in to portal');
    expect(p.textContent).toBe('Institution');
  });

  it('translates translatable attributes', () => {
    container.innerHTML = `
      <input id="email" type="email" placeholder="Email address" title="Email address" aria-label="Email address" />
    `;

    const dict = {
      'Email address': 'ईमेल पता',
    };

    applyTranslation('hi', dict);
    const input = container.querySelector('input')!;
    expect(input.getAttribute('placeholder')).toBe('ईमेल पता');
    expect(input.getAttribute('title')).toBe('ईमेल पता');
    expect(input.getAttribute('aria-label')).toBe('ईमेल पता');

    // Switch back to English
    applyTranslation('en', null);
    expect(input.getAttribute('placeholder')).toBe('Email address');
  });

  it('skips elements with translate="no", data-no-translate, or class notranslate', () => {
    container.innerHTML = `
      <div>
        <p id="t1">Applications</p>
        <p id="t2" translate="no">Applications</p>
        <p id="t3" data-no-translate>Applications</p>
        <p id="t4" class="notranslate">Applications</p>
        <code>Applications</code>
      </div>
    `;

    const dict = {
      'Applications': 'आवेदन',
    };

    applyTranslation('hi', dict);
    expect(container.querySelector('#t1')!.textContent).toBe('आवेदन');
    expect(container.querySelector('#t2')!.textContent).toBe('Applications');
    expect(container.querySelector('#t3')!.textContent).toBe('Applications');
    expect(container.querySelector('#t4')!.textContent).toBe('Applications');
    expect(container.querySelector('code')!.textContent).toBe('Applications');
  });

  it('falls back to English when a string is missing in the dictionary', () => {
    container.innerHTML = `
      <p id="known">Institution</p>
      <p id="unknown">Some brand new untranslated string</p>
    `;

    const dict = {
      'Institution': 'संस्थान',
    };

    applyTranslation('hi', dict);
    expect(container.querySelector('#known')!.textContent).toBe('संस्थान');
    // UI never breaks, falls back to original English
    expect(container.querySelector('#unknown')!.textContent).toBe('Some brand new untranslated string');
  });
});

describe('i18n: LanguageSwitcher Component', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    destroy();
    localStorage.clear();
  });

  it('renders language switcher and allows opening dropdown', async () => {
    render(<LanguageSwitcher />);

    // Wait for available languages to load
    const button = await screen.findByRole('button', { name: /language/i });
    expect(button).toBeInTheDocument();

    // Click to open menu
    fireEvent.click(button);

    // Dropdown should show available languages
    const menu = await screen.findByRole('menu');
    expect(menu).toBeInTheDocument();
    expect(screen.getAllByText('English').length).toBeGreaterThan(0);
    expect(screen.getByText('हिन्दी')).toBeInTheDocument();
    expect(screen.getByText('தமிழ்')).toBeInTheDocument();
  });

  it('switches language and persists choice to localStorage', async () => {
    render(<LanguageSwitcher />);

    const button = await screen.findByRole('button', { name: /language/i });
    fireEvent.click(button);

    const hindiOption = await screen.findByText('हिन्दी');
    fireEvent.click(hindiOption);

    await waitFor(() => {
      expect(localStorage.getItem('approvalflow-lang')).toBe('hi');
      expect(document.documentElement.lang).toBe('hi');
    });
  });

  it('closes on Escape key press', async () => {
    render(<LanguageSwitcher />);

    const button = await screen.findByRole('button', { name: /language/i });
    fireEvent.click(button);

    const menu = await screen.findByRole('menu');
    expect(menu).toBeInTheDocument();

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('i18n: Configuration & Glossary Integrity', () => {
  it('has all 10 scheduled Indian languages in languages config', () => {
    const codes = ALL_LANGUAGES.map(l => l.code);
    expect(codes).toEqual(['hi', 'mr', 'ta', 'bn', 'gu', 'te', 'kn', 'ml', 'pa', 'or']);
    expect(ENGLISH.code).toBe('en');
  });

  it('has essential AICTE terms in glossary set', () => {
    expect(GLOSSARY_SET.has('AICTE')).toBe(true);
    expect(GLOSSARY_SET.has('EVC')).toBe(true);
    expect(GLOSSARY_SET.has('SAC')).toBe(true);
    expect(GLOSSARY_SET.has('SHC')).toBe(true);
    expect(GLOSSARY_SET.has('APH')).toBe(true);
    expect(GLOSSARY_SET.has('EOA')).toBe(true);
    expect(GLOSSARY_SET.has('PDF')).toBe(true);
    expect(GLOSSARY_SET.has('CSV')).toBe(true);
  });
});
