/**
 * Glossary of abbreviations that must ALWAYS remain in English when translating.
 * The DOM translator will not translate these, and the checker will flag locale
 * files that alter them.
 */
export const GLOSSARY: readonly string[] = [
  'AICTE',
  'EVC',
  'SAC',
  'SHC',
  'APH',
  'NSWS',
  'EOA',
  'DSC',
  'PDF',
  'SLA',
  'ID',
  'OTP',
  'CSV',
  'IST',
  'AF',
  'NRI',
  'NBA',
  'NAAC',
  'UGC',
  'DOC',
  'URL',
  'API',
];

/** Set of glossary terms for O(1) lookup */
export const GLOSSARY_SET: ReadonlySet<string> = new Set(GLOSSARY);
