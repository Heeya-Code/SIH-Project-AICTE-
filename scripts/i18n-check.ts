import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const i18nDir = path.join(rootDir, 'web', 'src', 'i18n');
const sourceFile = path.join(i18nDir, 'source', 'en.json');
const localesDir = path.join(i18nDir, 'locales');
const glossaryFile = path.join(i18nDir, 'glossary.ts');

// Extract glossary terms from glossary.ts
const glossaryContent = fs.readFileSync(glossaryFile, 'utf8');
const glossaryMatch = glossaryContent.match(/export const GLOSSARY: readonly string\[\] = \[([\s\S]*?)\];/);
if (!glossaryMatch) {
  console.error('Failed to parse glossary.ts');
  process.exit(1);
}
const GLOSSARY: string[] = glossaryMatch[1]
  .split('\n')
  .map(line => line.trim().replace(/^['"]|['"],?$/g, ''))
  .filter(term => term.length > 0 && !term.startsWith('//'));

// Read source en.json
if (!fs.existsSync(sourceFile)) {
  console.error(`Source file not found: ${sourceFile}`);
  process.exit(1);
}
const enDict: Record<string, string> = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
const enKeys = Object.keys(enDict);

console.log(`\n========================================`);
console.log(`ApprovalFlow i18n Locale Validation`);
console.log(`========================================`);
console.log(`English source keys: ${enKeys.length}`);
console.log(`Glossary terms: ${GLOSSARY.join(', ')}\n`);

const localeFiles = fs.readdirSync(localesDir).filter(f => f.endsWith('.json'));
if (localeFiles.length === 0) {
  console.error('No locale files found in', localesDir);
  process.exit(1);
}

let totalErrors = 0;

for (const file of localeFiles) {
  const langCode = path.basename(file, '.json');
  const filePath = path.join(localesDir, file);
  let dict: Record<string, string>;

  console.log(`Checking [${langCode}] (${file})...`);

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    dict = JSON.parse(raw);
  } catch (err: any) {
    console.error(`  ❌ Invalid JSON: ${err.message}`);
    totalErrors++;
    continue;
  }

  let langErrors = 0;
  const dictKeys = Object.keys(dict);

  // 1. Missing keys
  const missingKeys = enKeys.filter(k => !(k in dict));
  if (missingKeys.length > 0) {
    console.error(`  ❌ Missing ${missingKeys.length} keys out of ${enKeys.length}`);
    if (missingKeys.length <= 5) {
      missingKeys.forEach(k => console.error(`     - "${k}"`));
    } else {
      missingKeys.slice(0, 3).forEach(k => console.error(`     - "${k}"`));
      console.error(`     ... and ${missingKeys.length - 3} more`);
    }
    langErrors++;
  }

  // 2. Empty values
  const emptyKeys = Object.entries(dict).filter(([_, v]) => !v || typeof v !== 'string' || v.trim().length === 0);
  if (emptyKeys.length > 0) {
    console.error(`  ❌ ${emptyKeys.length} empty translation value(s)`);
    emptyKeys.slice(0, 3).forEach(([k]) => console.error(`     - "${k}"`));
    langErrors++;
  }

  // 3. Glossary checks
  let glossaryErrors = 0;
  for (const [key, val] of Object.entries(dict)) {
    if (typeof val !== 'string') continue;
    for (const term of GLOSSARY) {
      // Check if the term appears in English key as a whole word
      const termRegex = new RegExp(`\\b${term}\\b`);
      if (termRegex.test(key)) {
        // Translation MUST contain the exact term
        if (!termRegex.test(val)) {
          glossaryErrors++;
          if (glossaryErrors <= 3) {
            console.error(`  ❌ Glossary term "${term}" missing in translation:`);
            console.error(`     Key:   "${key}"`);
            console.error(`     Value: "${val}"`);
          }
        }
      }
    }
  }
  if (glossaryErrors > 0) {
    if (glossaryErrors > 3) {
      console.error(`  ❌ Total glossary violations: ${glossaryErrors}`);
    }
    langErrors++;
  }

  // 4. Token placeholder checks ({0}, {1}, etc.)
  let tokenErrors = 0;
  for (const [key, val] of Object.entries(dict)) {
    if (typeof val !== 'string') continue;
    const keyTokens = key.match(/\{(\d+)\}/g) ?? [];
    const valTokens = val.match(/\{(\d+)\}/g) ?? [];
    const keyTokenSet = new Set(keyTokens);
    const valTokenSet = new Set(valTokens);

    for (const token of keyTokenSet) {
      if (!valTokenSet.has(token)) {
        tokenErrors++;
        if (tokenErrors <= 3) {
          console.error(`  ❌ Placeholder ${token} missing in translation:`);
          console.error(`     Key:   "${key}"`);
          console.error(`     Value: "${val}"`);
        }
      }
    }
  }
  if (tokenErrors > 0) {
    if (tokenErrors > 3) {
      console.error(`  ❌ Total token placeholder violations: ${tokenErrors}`);
    }
    langErrors++;
  }

  if (langErrors === 0) {
    console.log(`  ✓ Passed: ${dictKeys.length} strings, 100% coverage, glossary intact\n`);
  } else {
    console.log(`  ❌ Failed with ${langErrors} error category(ies)\n`);
    totalErrors += langErrors;
  }
}

if (totalErrors > 0) {
  console.error(`\n❌ i18n check FAILED with ${totalErrors} total error(s).\n`);
  process.exit(1);
} else {
  console.log(`\n✓ All ${localeFiles.length} locale file(s) PASSED validation successfully.\n`);
  process.exit(0);
}
