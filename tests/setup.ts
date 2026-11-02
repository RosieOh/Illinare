import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

// 테스트가 실제 사용자 데이터를 건드리지 않도록 워커마다 임시 디렉터리를 쓴다.
const dataDir = mkdtempSync(join(tmpdir(), 'illionaire-test-'));
process.env.ILLIONAIRE_DATA_DIR = dataDir;
delete process.env.ANTHROPIC_API_KEY;

afterAll(() => rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 }));
