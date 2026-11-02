#!/usr/bin/env node
/**
 * 실제 Claude API로 미션을 끝까지 돌려 본다 (이슈 #2).
 *   ANTHROPIC_API_KEY=... node scripts/live-check.mjs --yes [--only 이름,이름] [--budget 달러] [--keep]
 *   node scripts/live-check.mjs --demo     키 없이 이 스크립트 자체만 점검한다
 *
 * 먼저 npm run build가 되어 있어야 한다. 앱 데이터는 임시 폴더를 쓰므로 실제 데이터를 건드리지 않는다.
 * 키는 환경 변수로만 받고 출력하거나 저장하지 않는다. 실제 비용이 나가므로 --yes 없이는 시작하지 않는다.
 * 쓰기 점검은 문서 폴더에 파일을 하나 만들었다가 되돌리기로 지운다.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};

const DEMO = has('demo');
const BUDGET = Number(flag('budget') ?? 0.75);
const ONLY = flag('only')?.split(',').filter(Boolean) ?? null;
const MISSION_TIMEOUT_MS = 5 * 60_000;
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  return ok;
}
function note(text) {
  console.log(`      ${text}`);
}

// ─── 시험 파일 ───────────────────────────────────────────────
/** 글자가 든 가장 작은 PDF */
function samplePdf(text) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    (() => {
      const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
      return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    })(),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const at = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) body += `${String(at).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

/** 한 색으로 칠한 PNG */
function samplePng(size, [r, g, b]) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

// ─── 서버 ────────────────────────────────────────────────────
function freePort() {
  return new Promise((ok, no) => {
    const probe = createServer();
    probe.once('error', no);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => ok(port));
    });
  });
}

async function startServer(dataDir) {
  const port = await freePort();
  const child = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
    env: { ...process.env, ILLIONAIRE_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log = (log + d).slice(-4000)));
  child.stderr.on('data', (d) => (log = (log + d).slice(-4000)));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`서버가 시작 중에 끝났어요.\n${log}`);
    const up = await fetch(`${base}/api/bootstrap`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
    if (up) return { base, child, log: () => log };
    if (Date.now() > deadline) throw new Error(`서버가 60초 안에 응답하지 않았어요.\n${log}`);
    await sleep(300);
  }
}

// ─── 미션 ────────────────────────────────────────────────────
let base = '';
async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${JSON.stringify(json)?.slice(0, 300)}`);
  return json;
}

/** 끝날 때까지 지켜본다. 승인은 모두 기록하고 onApproval이 정한 대로 답한다. */
async function watch(id, onApproval = () => 'approve') {
  const seen = new Map();
  const deadline = Date.now() + MISSION_TIMEOUT_MS;
  for (;;) {
    const view = await api('GET', `/api/missions/${id}`);
    for (const approval of view.approvals) {
      if (seen.has(approval.id)) continue;
      seen.set(approval.id, approval);
      await api('POST', `/api/missions/${id}/approvals/${approval.id}`, { decision: onApproval(approval) });
    }
    if (TERMINAL.has(view.status)) return { view, approvals: [...seen.values()] };
    if (Date.now() > deadline) {
      await api('DELETE', `/api/missions/${id}`).catch(() => undefined);
      return { view: { ...view, status: 'timeout' }, approvals: [...seen.values()] };
    }
    await sleep(1000);
  }
}

async function run(goal, onApproval) {
  const { id } = await api('POST', '/api/missions', { goal });
  const outcome = await watch(id, onApproval);
  return { id, ...outcome };
}

const toolCalls = (view) => Object.values(view.steps).flatMap((s) => s.toolCalls);
const spend = [];
function describe(name, { view, approvals }) {
  const u = view.usage;
  spend.push({ name, cost: u.costUsd, input: u.inputTokens, output: u.outputTokens, cacheRead: u.cacheReadTokens, cacheWrite: u.cacheWriteTokens });
  note(`${view.status}, 경로 ${view.plan?.route ?? '-'}, 단계 ${view.stepOrder.length}, 승인 ${approvals.length}, 비용 $${u.costUsd.toFixed(4)}, 입력 ${u.inputTokens}, 출력 ${u.outputTokens}, 캐시 읽기 ${u.cacheReadTokens}`);
  if (view.error) note(`오류: ${view.error.code}: ${view.error.message}`);
  for (const step of Object.values(view.steps)) if (step.error) note(`단계 오류 ${step.step.id}: ${step.error}`);
}
const finished = (name, outcome) => {
  describe(name, outcome);
  return check(`${name}: 미션이 끝까지 완료됨`, outcome.view.status === 'done', outcome.view.error?.code ?? outcome.view.status);
};

// ─── 점검 항목 ───────────────────────────────────────────────
const SCENARIOS = {
  async answer() {
    const outcome = await run('대한민국의 수도가 어디인지 한 문장으로만 답해 줘. 도구는 쓰지 마.');
    if (!finished('답변 경로', outcome)) return;
    check('답변 경로: 지휘자가 바로 답함', outcome.view.plan?.route === 'answer', outcome.view.plan?.route ?? '');
    check('답변 경로: 답에 서울이 있음', outcome.view.answer.includes('서울'));
    check('사용량과 비용이 기록됨', outcome.view.usage.inputTokens > 0 && outcome.view.usage.costUsd > 0);
    const followup = '이번에는 일본의 수도를 한 문장으로만 답해 줘.';
    await api('POST', `/api/missions/${outcome.id}/followup`, { goal: followup });
    await sleep(500);
    const second = await watch(outcome.id);
    describe('후속 지시', second);
    check('후속 지시가 완료됨', second.view.status === 'done' && second.view.answer.includes('도쿄'));
    note(`프롬프트 캐시: 첫 턴 읽기 ${outcome.view.usage.cacheReadTokens}, 후속까지 읽기 ${second.view.usage.cacheReadTokens}`);
  },

  async web() {
    const outcome = await run('Anthropic의 최신 Claude 모델 이름을 웹에서 찾아 출처와 함께 두세 문장으로 알려 줘.');
    if (!finished('리서처 웹 조사', outcome)) return;
    const calls = toolCalls(outcome.view);
    const search = calls.filter((c) => c.name === 'web_search');
    const fetched = calls.filter((c) => c.name === 'web_fetch');
    check('web_search 응답 블록이 처리됨', search.length > 0 && search.every((c) => c.status === 'done'), `${search.length}회`);
    note(`web_fetch ${fetched.length}회. 모델이 쓰지 않았다면 이번 실행에서는 확인되지 않은 것이에요.`);
    if (fetched.length) check('web_fetch 응답 블록이 처리됨', fetched.every((c) => c.status === 'done'));
    // fallbacks와 베타 헤더를 계정이 받지 않으면 첫 호출이 400으로 실패해 여기까지 오지 못한다.
    check('fallbacks와 베타 헤더가 받아들여짐', true);
  },

  async code() {
    const primes = (n) => Array.from({ length: n - 1 }, (_, i) => i + 2).filter((v) => Array.from({ length: v - 2 }, (_, i) => i + 2).every((d) => v % d));
    const expected = primes(200).reduce((a, b) => a + b, 0);
    const outcome = await run('200 이하의 소수를 모두 더한 값을 반드시 코드를 실행해서 계산하고, 결과 숫자를 알려 줘.');
    if (!finished('애널리스트 코드 실행', outcome)) return;
    const calls = toolCalls(outcome.view).filter((c) => /code_execution/.test(c.name));
    check('code_execution이 실행됨', calls.length > 0 && calls.every((c) => c.status === 'done'), `${calls.length}회`);
    check('계산 결과가 맞음', outcome.view.answer.replace(/,/g, '').includes(String(expected)), String(expected));
  },

  async read(dir) {
    const pdf = join(dir, 'sample.pdf');
    const png = join(dir, 'sample.png');
    writeFileSync(pdf, samplePdf('ILLIONAIRE-PDF-7319'));
    writeFileSync(png, samplePng(64, [220, 30, 30]));
    const outcome = await run(`다음 두 파일을 read_file로 읽고, PDF에 적힌 글자와 이미지의 색을 알려 줘.\n${pdf}\n${png}`);
    if (!finished('PDF와 이미지 첨부', outcome)) return;
    const reads = toolCalls(outcome.view).filter((c) => c.name === 'read_file');
    check('read_file이 두 번 이상 성공함', reads.filter((c) => c.status === 'done').length >= 2, `${reads.length}회`);
    check('PDF 내용을 읽음', outcome.view.answer.includes('7319'));
    check('이미지를 봄', /빨강|붉은|red/i.test(outcome.view.answer));
  },

  async write() {
    const folder = join(homedir(), 'Documents');
    if (!existsSync(folder)) return check('쓰기 승인과 되돌리기', false, `문서 폴더가 없어요: ${folder}`);
    const name = `illionaire-live-check-${Date.now()}.txt`;
    const target = join(folder, name);
    const text = '일리네어 실제 API 점검 파일이에요.';
    try {
      const outcome = await run(`문서 폴더(${folder})에 ${name} 파일을 만들고 내용을 정확히 "${text}"라고 써 줘. write_file을 써.`);
      if (!finished('쓰기 승인', outcome)) return;
      const approval = outcome.approvals.find((a) => a.tool === 'write_file');
      check('쓰기 전에 승인을 물음', Boolean(approval));
      check('승인에 변경 비교가 있음', approval?.preview?.kind === 'diff' && (approval.preview.after ?? '').includes(text));
      check('파일이 실제로 써짐', existsSync(target) && readFileSync(target, 'utf8').includes(text));
      const { entries } = await api('GET', `/api/audit?missionId=${outcome.id}`);
      const entry = entries.find((e) => e.tool === 'write_file');
      check('활동 기록에 남음', entry?.status === 'ok' && entry.approvedBy === 'user');
      check('되돌릴 수 있다고 기록됨', entry?.undoable === true);
      if (entry?.undoable) {
        await api('POST', `/api/audit/${entry.id}/undo`, {});
        check('되돌리기로 파일이 사라짐', !existsSync(target));
      }
    } finally {
      rmSync(target, { force: true });
    }
  },

  async taint(dir) {
    const file = join(dir, 'company.txt');
    writeFileSync(file, '조사할 회사: Anthropic');
    const outcome = await run(`먼저 ${file} 파일을 읽어 회사 이름을 확인한 다음, 리서처가 그 회사의 공식 웹사이트 주소를 웹에서 찾아 알려 줘.`);
    if (!finished('오염된 리서처', outcome)) return;
    const web = outcome.approvals.find((a) => a.tool === 'web_access');
    note(web ? `웹 사용 승인을 물음: ${web.summary}` : '웹 사용 승인이 나오지 않음. 지휘자가 계획을 나누지 않았을 수 있어요.');
    check('외부 데이터를 읽은 리서처가 웹 사용 승인을 받음', Boolean(web));
  },
};

async function demoCheck() {
  const outcome = await run('경쟁사 가격을 조사해서 보고서로 정리해줘');
  describe('데모', outcome);
  check('데모 미션이 끝까지 완료됨', outcome.view.status === 'done' && outcome.view.mode === 'demo');
  check('승인을 처리함', outcome.approvals.length > 0, `${outcome.approvals.length}건`);
  check('도구 호출이 보임', toolCalls(outcome.view).length > 0);
  check('테스트 파일을 만들 수 있음', samplePdf('x').subarray(0, 5).toString() === '%PDF-' && samplePng(2, [0, 0, 0]).length > 40);
}

// ─── 실행 ────────────────────────────────────────────────────
if (!existsSync('.next/BUILD_ID')) {
  console.error('먼저 npm run build를 실행해 주세요.');
  process.exit(2);
}
const names = Object.keys(SCENARIOS).filter((n) => !ONLY || ONLY.includes(n));
if (!DEMO) {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error('ANTHROPIC_API_KEY 환경 변수가 필요해요. 키 없이 스크립트만 점검하려면 --demo를 쓰세요.');
    process.exit(2);
  }
  if (!has('yes')) {
    console.error(`실제 비용이 나가요. 미션 약 ${names.length}개, 미션당 상한 $${BUDGET} (상한은 근사치예요). 진행하려면 --yes를 붙여 주세요.`);
    console.error(`점검 항목: ${names.join(', ')}`);
    process.exit(2);
  }
} else {
  // 환경에 키가 있어도 데모는 돈을 쓰지 않는다.
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
}

const work = mkdtempSync(join(tmpdir(), 'illionaire-live-'));
const dataDir = join(work, 'data');
const filesDir = join(work, 'files');
mkdirSync(dataDir);
mkdirSync(filesDir);
let server;
let code = 1;
try {
  server = await startServer(dataDir);
  base = server.base;
  await api('PATCH', '/api/settings', { onboarded: true, budgetUsd: BUDGET });
  const boot = await api('GET', '/api/bootstrap');
  if (DEMO) {
    check('키 없이 데모 모드로 시작됨', boot.mode === 'demo', boot.mode);
    await demoCheck();
  } else {
    check('환경 변수의 키를 씀', boot.apiKeySource === 'env' && boot.mode === 'live', `${boot.apiKeySource}, ${boot.mode}`);
    for (const name of names) {
      console.log(`\n── ${name}`);
      try {
        await SCENARIOS[name](filesDir);
      } catch (err) {
        check(`${name}: 점검 중 오류`, false, err instanceof Error ? err.message : String(err));
      }
    }
    console.log('\n── 비용');
    for (const row of spend) note(`${row.name}: $${row.cost.toFixed(4)} (입력 ${row.input}, 출력 ${row.output}, 캐시 읽기 ${row.cacheRead}, 캐시 쓰기 ${row.cacheWrite})`);
    note(`합계 $${spend.reduce((a, r) => a + r.cost, 0).toFixed(4)}. 후속 지시 줄은 누적값이라 합계가 실제보다 클 수 있어요.`);
    check('프롬프트 캐시가 적중함', spend.some((r) => r.cacheRead > 0), `읽기 최대 ${Math.max(0, ...spend.map((r) => r.cacheRead))}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 통과`);
  if (failed.length) for (const f of failed) console.log(`  실패: ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  code = failed.length ? 1 : 0;
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  if (server) console.error(server.log());
} finally {
  server?.child.kill();
  if (has('keep')) console.log(`임시 폴더: ${work}`);
  else await sleep(500).then(() => rmSync(work, { recursive: true, force: true, maxRetries: 3 }));
}
process.exit(code);
