import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'af-test-'));
process.env.LOGIN_RATE_LIMIT = '100000';
process.env.NODE_ENV = 'test';
