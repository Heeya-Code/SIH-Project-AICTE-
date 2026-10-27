/**
 * In-place DOM translator for the ApprovalFlow multi-language UI.
 *
 * Design:
 * - Walks text nodes and translatable attributes under the app root.
 * - MutationObserver catches later-rendered content (route changes, modals, loaded data).
 * - Never adds, removes, or wraps DOM nodes — React remains in control.
 * - Keeps each node's original English in a WeakMap so switching back to English restores exactly.
 * - Normalises strings before lookup: replaces numbers, dates, times, currency, emails, URLs,
 *   and reference codes with {0}, {1}, … placeholders; looks up the normalised key; restores tokens.
 * - Skips elements with translate="no", class notranslate, data-no-translate,
 *   and <script>, <style>, <code>, <pre>, <input> values, <textarea> contents.
 * - Falls back to English for any missing string.
 */

import { GLOSSARY_SET } from './glossary';

// ─── Types ───────────────────────────────────────────────────────────────────

type Dict = Record<string, string>;

// ─── Constants ───────────────────────────────────────────────────────────────

const TRANSLATABLE_ATTRS = ['placeholder', 'title', 'aria-label', 'alt'] as const;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT', 'SVG']);

// ─── Normalisation ───────────────────────────────────────────────────────────

/**
 * Patterns that match tokens to replace with numbered placeholders.
 * Order matters: longer/more specific patterns first.
 */
const TOKEN_PATTERNS: RegExp[] = [
  // Reference codes like AICTE/2026/0001, AF-2026-00001, DOC-0001, UND-001
  /\b[A-Z]{2,5}[-/]\d{4}[-/]\d{3,5}\b/g,
  /\b[A-Z]{2,5}-\d{3,5}\b/g,
  // Emails
  /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,
  // URLs
  /https?:\/\/[^\s<>"]+/gi,
  // ISO date-times  2026-03-02T05:00:00Z
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[A-Z]?/g,
  // Dates  2026-03-02  or  2 Mar 2026  or  02/03/2026
  /\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{4}/g,
  /\d{4}-\d{2}-\d{2}/g,
  /\d{1,2}\/\d{1,2}\/\d{4}/g,
  // Times  14:30 IST  or  2:30 PM
  /\d{1,2}:\d{2}(?:\s?(?:AM|PM|IST))?/gi,
  // Currency ₹1,23,456.78
  /₹[\d,]+(?:\.\d+)?/g,
  // Percentages
  /\d+(?:\.\d+)?%/g,
  // Numbers (standalone, not part of a word). We capture integers and decimals.
  /(?<!\w)\d[\d,]*(?:\.\d+)?(?!\w)/g,
];

export interface NormaliseResult {
  key: string;
  tokens: string[];
}

/**
 * Replace variable tokens in a string with numbered placeholders.
 * Returns the normalised key and the extracted tokens.
 */
export function normalise(text: string): NormaliseResult {
  const tokens: string[] = [];
  let key = text;

  for (const pattern of TOKEN_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    key = key.replace(pattern, (match) => {
      tokens.push(match);
      return `{${tokens.length - 1}}`;
    });
  }

  return { key: key.trim(), tokens };
}

/**
 * Restore tokens into a translated string.
 */
export function restoreTokens(translated: string, tokens: string[]): string {
  return translated.replace(/\{(\d+)\}/g, (_, idx) => {
    const i = Number(idx);
    return i < tokens.length ? tokens[i] : `{${idx}}`;
  });
}

// ─── Skip logic ──────────────────────────────────────────────────────────────

function shouldSkipElement(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.getAttribute('translate') === 'no') return true;
  if (el.hasAttribute('data-no-translate')) return true;
  if (el.classList.contains('notranslate')) return true;
  return false;
}

function shouldSkipNode(node: Node): boolean {
  let el: Element | null = node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement;
  while (el) {
    if (shouldSkipElement(el)) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Returns true if the string is only tokens, symbols, whitespace, or glossary
 * abbreviations — i.e. nothing that should be translated.
 */
function isTokenOnly(key: string): boolean {
  // After normalisation, if only placeholders, punctuation, whitespace, and glossary remain
  const stripped = key
    .replace(/\{\d+\}/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
  if (stripped.length === 0) return true;
  // Check if remaining text is only glossary terms
  const words = stripped.split(/\s+/);
  return words.every(w => GLOSSARY_SET.has(w));
}

// ─── Translator class ────────────────────────────────────────────────────────

/** WeakMap stores original English text for each text node or attribute */
const originalText = new WeakMap<Node, string>();
const originalAttrs = new WeakMap<Element, Map<string, string>>();

let currentDict: Dict | null = null;
let currentLang: string = 'en';
let observer: MutationObserver | null = null;
let appRoot: Element | null = null;

// Dev-mode harvest set (only populated in DEV)
let harvestedMissing: Set<string> | null = null;
let harvestListeners: Array<() => void> = [];

function translateTextNode(node: Text, dict: Dict): void {
  const original = originalText.get(node) ?? node.textContent;
  if (!original || !original.trim()) return;

  // Store original English
  if (!originalText.has(node)) {
    originalText.set(node, original);
  }

  const { key, tokens } = normalise(original);
  if (isTokenOnly(key)) return;

  const translated = dict[key];
  if (translated) {
    node.textContent = restoreTokens(translated, tokens);
  } else {
    // Fallback: restore English
    node.textContent = original;
    // Record missing in dev mode
    if (harvestedMissing && key) {
      const before = harvestedMissing.size;
      harvestedMissing.add(key);
      if (harvestedMissing.size > before) {
        harvestListeners.forEach(fn => fn());
      }
    }
  }
}

function translateAttributes(el: Element, dict: Dict): void {
  for (const attr of TRANSLATABLE_ATTRS) {
    const value = el.getAttribute(attr);
    if (!value) continue;

    // Store original
    if (!originalAttrs.has(el)) {
      originalAttrs.set(el, new Map());
    }
    const map = originalAttrs.get(el)!;
    if (!map.has(attr)) {
      map.set(attr, value);
    }

    const original = map.get(attr)!;
    const { key, tokens } = normalise(original);
    if (isTokenOnly(key)) continue;

    const translated = dict[key];
    if (translated) {
      el.setAttribute(attr, restoreTokens(translated, tokens));
    } else {
      el.setAttribute(attr, original);
      if (harvestedMissing && key) {
        const before = harvestedMissing.size;
        harvestedMissing.add(key);
        if (harvestedMissing.size > before) {
          harvestListeners.forEach(fn => fn());
        }
      }
    }
  }
}

function restoreTextNode(node: Text): void {
  const original = originalText.get(node);
  if (original != null) {
    node.textContent = original;
  }
}

function restoreAttributes(el: Element): void {
  const map = originalAttrs.get(el);
  if (!map) return;
  for (const [attr, value] of map) {
    el.setAttribute(attr, value);
  }
}

function walkAndTranslate(root: Node, dict: Dict): void {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE && shouldSkipElement(node as Element)) {
          return NodeFilter.FILTER_REJECT; // skip this subtree
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let node: Node | null = walker.currentNode;
  // Process root if it's an element
  if (node.nodeType === Node.ELEMENT_NODE) {
    translateAttributes(node as Element, dict);
  }

  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      translateTextNode(node as Text, dict);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      translateAttributes(node as Element, dict);
    }
  }
}

function walkAndRestore(root: Node): void {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );

  let node: Node | null = walker.currentNode;
  if (node.nodeType === Node.ELEMENT_NODE) {
    restoreAttributes(node as Element);
  }

  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      restoreTextNode(node as Text);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      restoreAttributes(node as Element);
    }
  }
}

// ─── MutationObserver handler ────────────────────────────────────────────────

function handleMutations(mutations: MutationRecord[]): void {
  if (!currentDict || currentLang === 'en') return;

  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      for (const added of mutation.addedNodes) {
        if (added.nodeType === Node.TEXT_NODE) {
          if (!shouldSkipNode(added)) {
            // Check if React updated text — re-store original
            const text = (added as Text).textContent;
            if (text?.trim()) {
              originalText.set(added as Text, text);
              translateTextNode(added as Text, currentDict);
            }
          }
        } else if (added.nodeType === Node.ELEMENT_NODE) {
          if (!shouldSkipElement(added as Element)) {
            walkAndTranslate(added, currentDict);
          }
        }
      }
    } else if (mutation.type === 'characterData') {
      const node = mutation.target;
      if (node.nodeType === Node.TEXT_NODE && !shouldSkipNode(node)) {
        // React updated text content — update our original and re-translate
        const newText = (node as Text).textContent;
        if (newText?.trim()) {
          originalText.set(node as Text, newText);
          translateTextNode(node as Text, currentDict);
        }
      }
    } else if (mutation.type === 'attributes') {
      const el = mutation.target as Element;
      const attr = mutation.attributeName;
      if (attr && TRANSLATABLE_ATTRS.includes(attr as any) && !shouldSkipNode(el)) {
        // Update the original and re-translate
        const newVal = el.getAttribute(attr);
        if (newVal != null) {
          if (!originalAttrs.has(el)) originalAttrs.set(el, new Map());
          originalAttrs.get(el)!.set(attr, newVal);
          translateAttributes(el, currentDict);
        }
      }
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Apply a translation dictionary to the DOM. Pass `null` to restore English.
 */
export function applyTranslation(lang: string, dict: Dict | null): void {
  const root = appRoot ?? document.getElementById('root') ?? document.body;
  if (!root) return;
  appRoot = root;

  // Disconnect observer during batch translate to avoid recursive triggers
  observer?.disconnect();

  if (!dict || lang === 'en') {
    // Restore all English
    walkAndRestore(root);
    currentDict = null;
    currentLang = 'en';
  } else {
    // If switching between non-English languages, restore English first
    if (currentDict && currentLang !== 'en') {
      walkAndRestore(root);
    }
    currentDict = dict;
    currentLang = lang;
    walkAndTranslate(root, dict);
  }

  // Re-attach observer
  if (!observer) {
    observer = new MutationObserver(handleMutations);
  }
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TRANSLATABLE_ATTRS],
  });

  // Set html lang
  document.documentElement.lang = lang;
}

/**
 * Get the current translation language.
 */
export function getCurrentLang(): string {
  return currentLang;
}

/**
 * Re-translate the entire DOM with the current dictionary.
 * Call this if you suspect the DOM has changed significantly.
 */
export function retranslate(): void {
  if (currentDict && currentLang !== 'en') {
    const root = appRoot ?? document.getElementById('root');
    if (root) walkAndTranslate(root, currentDict);
  }
}

// ─── Dev-mode harvest ────────────────────────────────────────────────────────

/**
 * Enable harvest mode (DEV only). Returns functions to get missing strings
 * and subscribe to changes.
 */
export function enableHarvest(): {
  getMissing: () => string[];
  subscribe: (fn: () => void) => () => void;
} {
  if (!harvestedMissing) {
    harvestedMissing = new Set();
  }
  return {
    getMissing: () => Array.from(harvestedMissing!),
    subscribe: (fn: () => void) => {
      harvestListeners.push(fn);
      return () => {
        harvestListeners = harvestListeners.filter(f => f !== fn);
      };
    },
  };
}

/** Disconnect the observer and clean up. */
export function destroy(): void {
  observer?.disconnect();
  observer = null;
  currentDict = null;
  currentLang = 'en';
  appRoot = null;
}
