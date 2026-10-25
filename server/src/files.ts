import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config';
import { badRequest } from './util';

// Content is identified by its leading bytes, not by the client-supplied MIME type or file name.
const KINDS = [
  { mime: 'application/pdf', ext: ['.pdf'], match: (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', ext: ['.png'], match: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: ['.jpg', '.jpeg'], match: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];
export const ALLOWED = 'PDF, PNG or JPEG';

export type StoredFile = { file_name: string; storage_ref: string; mime: string; size: number };

export function saveUpload(file: { originalname: string; buffer: Buffer; size: number } | undefined): StoredFile {
  if (!file) throw badRequest('Attach a file');
  if (file.size === 0) throw badRequest('The file is empty');
  if (file.size > config.maxUploadBytes) throw badRequest(`File is larger than ${Math.round(config.maxUploadBytes / 1048576)} MB`);
  const ext = path.extname(file.originalname).toLowerCase();
  const kind = KINDS.find(k => k.match(file.buffer));
  if (!kind || !kind.ext.includes(ext)) throw badRequest(`Only ${ALLOWED} files are accepted, and the file content must match its extension`);
  fs.mkdirSync(config.storageDir, { recursive: true });
  const ref = `${crypto.randomUUID()}${kind.ext[0]}`; // server-generated name: no user input reaches the path
  fs.writeFileSync(path.join(config.storageDir, ref), file.buffer, { mode: 0o600 });
  const safeName = path.basename(file.originalname).replace(/[^\w.\- ]/g, '_').slice(0, 120) || `file${kind.ext[0]}`;
  return { file_name: safeName, storage_ref: ref, mime: kind.mime, size: file.size };
}

export function storedPath(ref: string): string {
  const p = path.resolve(config.storageDir, path.basename(ref));
  if (!p.startsWith(path.resolve(config.storageDir) + path.sep)) throw badRequest('Invalid file reference');
  return p;
}

// Tiny valid PDF used for synthetic seed documents.
export function placeholderPdf(label: string): Buffer {
  const text = label.replace(/[()\\]/g, '');
  const body = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${text.length + 60}>>stream\nBT /F1 14 Tf 20 100 Td (SYNTHETIC DEMO DOCUMENT: ${text}) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF`;
  return Buffer.from(body, 'latin1');
}
