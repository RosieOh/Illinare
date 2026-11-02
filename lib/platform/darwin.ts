import { homedir } from 'node:os';
import { run, runWithStdin } from './exec';
import type { ActivitySample, Platform, RawProcess } from './types';
import { webUrl } from './url';

/** AppleScript 문자열 리터럴 안에 안전하게 들어가도록 이스케이프한다. */
export function escapeOsaString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
}

/** AppleScript 한 조각 실행. 스크립트의 $$ 자리에 이스케이프된 값을 넣는다. */
export async function osa(script: string, ...replacements: string[]): Promise<string> {
  let i = 0;
  const filled = script.replace(/\$\$/g, () => escapeOsaString(replacements[i++] ?? ''));
  const { stdout } = await run('/usr/bin/osascript', ['-e', filled], { timeoutMs: 8000 });
  return stdout.trim();
}

/** `ps -o pid=,pcpu=,rss=,comm=` 출력 파싱. macOS와 Linux 공통. */
export function parsePs(stdout: string): RawProcess[] {
  return stdout
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({
      pid: Number(m[1]),
      cpuPct: Number(m[2]),
      memMb: Number(m[3]) / 1024,
      name: m[4].split('/').pop() ?? m[4],
    }));
}

function pageCount(stdout: string, label: string): number {
  const line = stdout.split('\n').find((l) => l.startsWith(label));
  return Number((line?.split(':')[1] ?? '').replace(/[^\d]/g, '')) || 0;
}

export const darwinPlatform: Platform = {
  id: 'darwin',
  has: () => true,
  osLabel: () => 'macOS',

  async getVolume() {
    return Number(await osa('output volume of (get volume settings)'));
  },

  async setVolume(level) {
    await osa(`set volume output volume ${Math.round(level)}`);
  },

  async getDarkMode() {
    const out = await osa('tell application "System Events" to tell appearance preferences to get dark mode');
    return out === 'true';
  },

  async setDarkMode(enabled) {
    await osa(
      `tell application "System Events" to tell appearance preferences to set dark mode to ${enabled ? 'true' : 'false'}`
    );
  },

  async lockScreen() {
    await run('/usr/bin/pmset', ['displaysleepnow']);
  },

  async sleep() {
    await run('/usr/bin/pmset', ['sleepnow']);
  },

  async notify({ title, body, sound }) {
    const parts = ['display notification "$$"', 'with title "$$"'];
    const args = [body ?? '', title];
    if (sound) {
      parts.push('sound name "$$"');
      args.push(sound);
    }
    await osa(parts.join(' '), ...args);
  },

  async say({ text, voice }) {
    const args = ['-r', '180'];
    if (voice) args.push('-v', voice);
    // 본문이 옵션으로 해석되지 않도록 구분자를 둔다.
    args.push('--', text);
    await run('/usr/bin/say', args, { timeoutMs: 60000 });
  },

  async listApps() {
    const out = await osa(
      'tell application "System Events" to get name of (every process whose background only is false)'
    );
    return out.split(', ').filter(Boolean);
  },

  async openApp(name) {
    // -a는 LaunchServices에 등록된 앱 번들만 찾는다. PATH의 스크립트는 실행되지 않는다.
    await run('/usr/bin/open', ['-a', name]);
  },

  async focusApp(name) {
    await osa('tell application "$$" to activate', name);
  },

  async quitApp(name) {
    await osa('tell application "$$" to quit', name);
  },

  async openUrl(url) {
    await run('/usr/bin/open', [webUrl(url)]);
  },

  async searchIndex(query, limit) {
    const { stdout } = await run('/usr/bin/mdfind', ['-onlyin', homedir(), query]);
    return stdout.trim().split('\n').filter(Boolean).slice(0, limit);
  },

  async screenshot(file) {
    await run('/usr/sbin/screencapture', ['-x', file], { timeoutMs: 8000 });
  },

  async clipboardRead() {
    return (await run('/usr/bin/pbpaste', [])).stdout;
  },

  async clipboardWrite(text) {
    await runWithStdin('/usr/bin/pbcopy', [], text);
  },

  async trash(path) {
    // 경로를 직접 문자열에 넣지 않고 공통 이스케이프를 거친다 (백슬래시 인젝션 방지).
    await osa('tell application "Finder" to delete POSIX file "$$"', path);
  },

  async sampleActivity(): Promise<ActivitySample> {
    const [procs, net] = await Promise.all([
      run('/bin/ps', ['-A', '-o', 'pid=,pcpu=,rss=,comm='], { maxBufferKb: 4096 }),
      run('/usr/sbin/netstat', ['-ibn']).catch(() => null),
    ]);
    let rxBytes: number | null = null;
    let txBytes: number | null = null;
    if (net) {
      rxBytes = 0;
      txBytes = 0;
      // 인터페이스마다 Link 행만 합산한다 (주소별 행은 중복이다).
      for (const line of net.stdout.split('\n')) {
        const cols = line.trim().split(/\s+/);
        if (cols.length >= 10 && cols[2]?.startsWith('<Link') && !cols[0].startsWith('lo')) {
          rxBytes += Number(cols[6]) || 0;
          txBytes += Number(cols[9]) || 0;
        }
      }
    }
    return { processes: parsePs(procs.stdout), rxBytes, txBytes };
  },

  async battery() {
    const { stdout } = await run('/usr/bin/pmset', ['-g', 'batt']);
    const match = stdout.match(/(\d+)%;\s*(\w+)/);
    if (!match) return null;
    return { percent: Number(match[1]), charging: match[2] !== 'discharging' };
  },

  async memoryUsedBytes() {
    // os.freemem()은 비활성/압축 메모리를 사용 중으로 쳐서 과장되므로 vm_stat을 쓴다.
    const { stdout } = await run('/usr/bin/vm_stat', []);
    const pageSize = Number(stdout.match(/page size of (\d+) bytes/)?.[1]) || 4096;
    const used =
      pageCount(stdout, 'Pages active') +
      pageCount(stdout, 'Pages wired down') +
      pageCount(stdout, 'Pages occupied by compressor');
    return used > 0 ? used * pageSize : null;
  },
};
