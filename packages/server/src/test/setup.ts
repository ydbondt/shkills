import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Runs before the test file's imports, so `config.ts` picks these up and every
// test file ends up with a private, throwaway database.
const dir = mkdtempSync(path.join(tmpdir(), 'shkills-test-'));
process.env.SHKILLS_DATA_DIR = dir;
process.env.SHKILLS_DB = path.join(dir, 'test.sqlite');
process.env.SHKILLS_JWT_SECRET = 'test-secret-not-used-in-production';
process.env.SHKILLS_PUBLIC_URL = 'http://shkills.test';
