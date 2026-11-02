import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 테스트가 실제 사용자 데이터를 건드리지 않도록 워커마다 임시 디렉터리를 쓴다.
process.env.ILLIONAIRE_DATA_DIR = mkdtempSync(join(tmpdir(), 'illionaire-test-'));
delete process.env.ANTHROPIC_API_KEY;
