#!/usr/bin/env node
/**
 * 패키징된 Windows 앱을 실제로 띄워 점검한다.
 *   node scripts/desktop-smoke.mjs [exe 경로] [--out 폴더] [--keep]
 * 사용자 데이터는 임시 폴더를 쓰므로 실제 앱 데이터를 건드리지 않는다.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};
const exe = resolve(argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out') ?? 'build/desktop/win-unpacked/Illionaire.exe');
const out = resolve(flag('out') ?? mkdtempSync(join(tmpdir(), 'illionaire-smoke-')));
const userData = mkdtempSync(join(tmpdir(), 'illionaire-ud-'));
const DEBUG_PORT = 9333;
mkdirSync(out, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`시간 초과: ${label}`);
    await sleep(250);
  }
}

function processes() {
  const raw = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${basename(exe)}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  return raw.split('\n').filter((l) => l.includes(basename(exe))).length;
}

/** 남은 프로세스의 종류를 알려 준다. 어떤 자식이 안 끝났는지 바로 알 수 있게 한다. */
function processDetails() {
  const script = `Get-CimInstance Win32_Process -Filter "Name='${basename(exe)}'" | ForEach-Object { if ($_.CommandLine -match '--(type|utility-sub-type)=\S+') { $matches[0] } else { 'main' } }`;
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim().replace(/s+/g, ' ');
}

const launch = (...args) => spawn(exe, [`--user-data-dir=${userData}`, ...args], { stdio: 'ignore', detached: false });
const closeWindow = (pid) => execFileSync('taskkill', ['/PID', String(pid)], { stdio: 'ignore' });

/** 창 영역만 실제 화면에서 캡처한다. 네이티브 창 컨트롤과 재질까지 보인다. */
function captureWindow(pid, file) {
  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W { [StructLayout(LayoutKind.Sequential)] public struct R { public int L,T,Ri,B; }
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }
'@
$h = (Get-Process -Id ${pid}).MainWindowHandle
[void][W]::SetForegroundWindow($h); Start-Sleep -Milliseconds 400
$r = New-Object W+R; [void][W]::GetWindowRect($h, [ref]$r)
$b = New-Object Drawing.Bitmap ($r.Ri-$r.L), ($r.B-$r.T)
$g = [Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($r.L, $r.T, 0, 0, $b.Size)
$b.Save($env:ILL_OUT)`;
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, ILL_OUT: file }, stdio: 'ignore' });
}

function sendSummonHotkey() {
  const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^+ ')`;
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' });
}

// 가짜 카메라와 마이크로 권한 처리기까지 실제로 거치게 한다.
const main = launch(`--remote-debugging-port=${DEBUG_PORT}`, '--use-fake-device-for-media-stream');
let browser;
try {
  const started = Date.now();
  browser = await until(() => puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}`, defaultViewport: null }), 45000, 'CDP 연결');
  const page = await until(async () => (await browser.pages()).find((p) => p.url().startsWith('http://127.0.0.1')), 45000, '앱 페이지');
  await page.waitForSelector('.composer-anchor textarea', { timeout: 45000 });
  const origin = new URL(page.url()).origin;
  check('창이 열리고 앱이 렌더링됨', true, `${Date.now() - started}ms, ${origin}`);

  const api = (method, path, body) =>
    page.evaluate(
      async (m, p, b) => {
        const res = await fetch(p, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
        return { status: res.status, json: await res.json().catch(() => null) };
      },
      method,
      path,
      body
    );

  // 쿠키 관문
  const noCookie = await fetch(`${origin}/api/bootstrap`);
  check('쿠키 없는 GET /api는 403', noCookie.status === 403, String(noCookie.status));
  const noCookiePost = await fetch(`${origin}/api/missions`, { method: 'POST', body: '{"goal":"x"}', headers: { 'Content-Type': 'application/json' } });
  check('쿠키 없는 POST /api는 403', noCookiePost.status === 403, String(noCookiePost.status));
  const wrong = await fetch(`${origin}/api/bootstrap`, { headers: { cookie: 'illionaire_session=wrong' } });
  check('잘못된 쿠키는 403', wrong.status === 403, String(wrong.status));
  const cookies = await page.cookies();
  const session = cookies.find((c) => c.name === 'illionaire_session');
  check('세션 쿠키가 httpOnly + SameSite=Strict', Boolean(session?.httpOnly && session?.sameSite === 'Strict'));
  const script = await page.evaluate(() => document.cookie.includes('illionaire_session'));
  check('페이지 스크립트가 쿠키를 읽지 못함', !script);

  const boot = await api('GET', '/api/bootstrap');
  check('앱은 API에 접근하고 desktop 플래그가 켜짐', boot.status === 200 && boot.json.desktop === true);
  check('데이터 폴더가 userData/data', resolve(boot.json.dataDir) === resolve(join(userData, 'data')), boot.json.dataDir);

  // 창 크롬 (끌기 띠는 bootstrap 응답 뒤에 그려진다)
  await page.waitForSelector('.app-drag', { timeout: 15000 }).catch(() => undefined);
  const chrome = await page.evaluate(() => {
    const r = document.documentElement;
    const drag = document.querySelector('.app-drag');
    const composer = document.querySelector('.composer-anchor textarea');
    return {
      desktop: r.dataset.desktop,
      platform: r.dataset.platform,
      dragHeight: drag ? getComputedStyle(drag).height : null,
      dragRegion: drag ? getComputedStyle(drag).getPropertyValue('-webkit-app-region') : null,
      composerRegion: composer ? getComputedStyle(composer).getPropertyValue('-webkit-app-region') : null,
      exposed: Object.keys(window).filter((k) => /illionaire|electron|ipc/i.test(k)),
      node: typeof window.require,
    };
  });
  check('html[data-desktop], 끌기 영역, no-drag 컨트롤', chrome.desktop === '1' && chrome.dragRegion === 'drag' && chrome.composerRegion === 'no-drag', JSON.stringify(chrome));
  check('페이지에 Node와 Electron API가 노출되지 않음', chrome.exposed.length === 0 && chrome.node === 'undefined');

  await page.screenshot({ path: join(out, '1-first-run.png') });

  // 권한
  const perms = await page.evaluate(async () => {
    const attempt = async (fn) => {
      try {
        return await fn();
      } catch (e) {
        return `거부: ${e.name}`;
      }
    };
    return {
      camera: await attempt(() => navigator.mediaDevices.getUserMedia({ video: true }).then((m) => (m.getTracks().forEach((t) => t.stop()), 'ok'))),
      microphone: await attempt(() => navigator.mediaDevices.getUserMedia({ audio: true }).then((m) => (m.getTracks().forEach((t) => t.stop()), 'ok'))),
      screen: await attempt(() => navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => 'ok')),
      clipboardWrite: await attempt(() => navigator.clipboard.writeText('illionaire-smoke').then(() => 'ok')),
      clipboardRead: await attempt(() => navigator.clipboard.readText().then(() => 'ok')),
      notification: await attempt(() => Notification.requestPermission()),
      geolocation: await attempt(() => new Promise((ok, no) => navigator.geolocation.getCurrentPosition(() => ok('ok'), (e) => no(new Error(e.message))))),
      fullscreen: await attempt(() => document.documentElement.requestFullscreen().then(() => document.exitFullscreen()).then(() => 'ok')),
      popup: window.open('file:///c:/') === null ? 'null' : 'opened',
    };
  });
  check('카메라, 마이크, 클립보드 쓰기, 전체 화면, 알림은 허용', perms.camera === 'ok' && perms.microphone === 'ok' && perms.clipboardWrite === 'ok' && perms.fullscreen === 'ok' && perms.notification === 'granted', JSON.stringify(perms));
  check('화면 공유, 클립보드 읽기, 위치, 새 창은 거부', perms.screen !== 'ok' && perms.clipboardRead !== 'ok' && perms.geolocation !== 'ok' && perms.popup === 'null');

  // 온보딩을 끝내고 데모 미션을 끝까지 돌린다.
  await api('PATCH', '/api/settings', { onboarded: true, displayName: '점검' });
  await page.reload();
  await page.waitForSelector('.composer-anchor textarea', { timeout: 30000 });
  await sleep(1200);
  await page.screenshot({ path: join(out, '2-today.png') });

  await page.type('.composer-anchor textarea', '경쟁사 가격을 조사해서 보고서로 정리해줘');
  await page.keyboard.press('Enter');
  const missionStats = async () => {
    const { json } = await api('GET', '/api/missions');
    return json.missions;
  };
  const first = await until(async () => (await missionStats())[0], 15000, '미션 생성');
  const firstId = first.id;
  check('입력창에서 데모 미션이 시작됨', first.mode === 'demo', first.status);

  const clickApprove = () =>
    page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '승인');
      button?.click();
      return Boolean(button);
    });

  await until(async () => (await missionStats()).find((m) => m.id === firstId)?.pendingApprovals > 0, 90000, '승인 요청');
  await sleep(500);
  await page.screenshot({ path: join(out, '3-approval.png') });
  captureWindow(main.pid, join(out, '3-approval-window.png'));
  const done = await until(async () => {
    const mission = (await missionStats()).find((m) => m.id === firstId);
    if (mission?.pendingApprovals > 0) await clickApprove();
    return mission && ['done', 'failed', 'cancelled'].includes(mission.status) ? mission : null;
  }, 180000, '미션 완료');
  check('데모 미션이 승인을 거쳐 완료됨', done.status === 'done', done.status);
  await sleep(800);
  await page.screenshot({ path: join(out, '4-done.png') });

  const missionFiles = readdirSync(join(userData, 'data', 'missions'));
  check('미션 데이터가 userData 아래에 저장됨', missionFiles.some((f) => f.endsWith('.jsonl')), missionFiles.join(', '));
  check('서버 로그가 userData/logs에 남음', existsSync(join(userData, 'logs', 'server.log')));

  // 두 번째 실행은 첫 번째 창을 앞으로 가져오고 끝나야 한다.
  const before = processes();
  const second = launch();
  const code = await Promise.race([new Promise((r) => second.once('exit', r)), sleep(15000).then(() => 'timeout')]);
  check('두 번째 실행은 스스로 종료됨', code === 0, String(code));
  check('두 번째 실행 뒤 프로세스 수가 늘지 않음', processes() <= before, `${before} → ${processes()}`);

  // 미션이 돌아가는 중에 닫으면 트레이로 숨는다.
  const running = await api('POST', '/api/missions', { goal: '이번 주 계획을 세워줘' });
  const runningId = running.json.id;
  await until(async () => (await missionStats()).find((m) => m.id === runningId)?.status !== 'planning', 30000, '두 번째 미션 시작');
  closeWindow(main.pid);
  await sleep(1500);
  const hidden = await page.evaluate(() => document.visibilityState);
  check('진행 중에 창을 닫으면 앱이 살아 있고 창이 숨겨짐', main.exitCode === null && hidden === 'hidden', hidden);
  const state = JSON.parse(readFileSync(join(userData, 'desktop-state.json'), 'utf8'));
  check('첫 숨김 안내를 한 번만 표시하도록 기록됨', state.closeNoticeShown === true);

  // 숨겨진 상태에서 전역 단축키를 누르면 창이 나타나고 입력창에 포커스가 간다.
  sendSummonHotkey();
  const summoned = await until(
    () => page.evaluate(() => (document.visibilityState === 'visible' && document.activeElement?.tagName === 'TEXTAREA' ? true : null)),
    6000,
    '전역 단축키'
  ).catch(() => false);
  check('전역 단축키로 창이 나타나고 입력창에 포커스', summoned === true);

  await until(async () => {
    const mission = (await missionStats()).find((m) => m.id === runningId);
    if (mission?.pendingApprovals > 0) {
      await page.evaluate(async (id) => {
        const m = await (await fetch(`/api/missions/${id}`)).json();
        await Promise.all(m.approvals.map((a) => fetch(`/api/missions/${id}/approvals/${a.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }) })));
      }, runningId);
    }
    return mission && ['done', 'failed', 'cancelled'].includes(mission.status);
  }, 180000, '두 번째 미션 완료');

  // 진행 중인 미션이 없으면 닫기는 앱 종료다. 고아 프로세스가 남으면 안 된다.
  const finalShow = launch();
  await new Promise((r) => finalShow.once('exit', r));
  await sleep(600);
  browser.disconnect();
  browser = null;
  closeWindow(main.pid);
  const closedAt = Date.now();
  const gone = await until(async () => (processes() === 0 ? true : null), 30000, '프로세스 종료').catch(() => false);
  check('닫으면 앱과 서버 프로세스가 모두 종료됨', gone === true, gone ? `${Date.now() - closedAt}ms` : processDetails());
} catch (err) {
  check('점검 중 오류', false, err instanceof Error ? err.message : String(err));
} finally {
  browser?.disconnect();
  try {
    execFileSync('taskkill', ['/F', '/T', '/IM', basename(exe)], { stdio: 'ignore' });
  } catch {
    /* 이미 종료됨 */
  }
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
  if (!argv.includes('--keep')) await sleep(500).then(() => rmSync(userData, { recursive: true, force: true }));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과. 결과: ${out}`);
  process.exit(failed ? 1 : 0);
}
