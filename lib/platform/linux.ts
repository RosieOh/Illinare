import { promises as fs } from 'node:fs';
import os from 'node:os';
import { parsePs } from './darwin';
import { onPath, run, runWithStdin } from './exec';
import { CapabilityError, type ActivitySample, type Capability, type Platform } from './types';
import { webUrl } from './url';

/** 리눅스는 데스크톱 환경마다 도구가 달라서 설치된 것을 찾아 쓴다. */
const firstAvailable = (...bins: string[]) => bins.find(onPath);

const audioTool = () => firstAvailable('wpctl', 'pactl', 'amixer');
const clipboardReadTool = () => firstAvailable('wl-paste', 'xclip', 'xsel');
const clipboardWriteTool = () => firstAvailable('wl-copy', 'xclip', 'xsel');
const speechTool = () => firstAvailable('spd-say', 'espeak-ng', 'espeak');
const screenshotTool = () => firstAvailable('grim', 'gnome-screenshot', 'scrot', 'import');

const CHECKS: Record<Capability, () => unknown> = {
  volume: audioTool,
  darkMode: () => onPath('gsettings'),
  lock: () => onPath('loginctl'),
  sleep: () => onPath('systemctl'),
  notify: () => onPath('notify-send'),
  say: speechTool,
  listApps: () => onPath('wmctrl'),
  openApp: () => onPath('gtk-launch'),
  focusApp: () => onPath('wmctrl'),
  quitApp: () => onPath('wmctrl'),
  openUrl: () => onPath('xdg-open'),
  screenshot: screenshotTool,
  clipboardRead: clipboardReadTool,
  clipboardWrite: clipboardWriteTool,
  trash: () => onPath('gio'),
};

function required<T>(value: T | undefined, what: string): T {
  if (!value) throw new CapabilityError(what);
  return value;
}

export const linuxPlatform: Platform = {
  id: 'linux',
  has: (capability) => Boolean(CHECKS[capability]()),
  osLabel: () => `Linux ${os.release()}`,

  async getVolume() {
    const tool = required(audioTool(), '볼륨');
    if (tool === 'wpctl') {
      const { stdout } = await run('wpctl', ['get-volume', '@DEFAULT_AUDIO_SINK@']);
      return Math.round(Number(stdout.match(/([\d.]+)/)?.[1] ?? 0) * 100);
    }
    const { stdout } =
      tool === 'pactl'
        ? await run('pactl', ['get-sink-volume', '@DEFAULT_SINK@'])
        : await run('amixer', ['get', 'Master']);
    return Number(stdout.match(/(\d+)%/)?.[1] ?? 0);
  },

  async setVolume(level) {
    const tool = required(audioTool(), '볼륨');
    const pct = Math.round(level);
    if (tool === 'wpctl') await run('wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', `${pct}%`]);
    else if (tool === 'pactl') await run('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${pct}%`]);
    else await run('amixer', ['set', 'Master', `${pct}%`]);
  },

  async getDarkMode() {
    const { stdout } = await run('gsettings', ['get', 'org.gnome.desktop.interface', 'color-scheme']);
    return stdout.includes('dark');
  },

  async setDarkMode(enabled) {
    await run('gsettings', [
      'set',
      'org.gnome.desktop.interface',
      'color-scheme',
      enabled ? 'prefer-dark' : 'default',
    ]);
  },

  async lockScreen() {
    await run('loginctl', ['lock-session']);
  },

  async sleep() {
    await run('systemctl', ['suspend']);
  },

  async notify({ title, body }) {
    await run('notify-send', ['--', title, body ?? '']);
  },

  async say({ text, voice }) {
    const tool = required(speechTool(), '음성 출력');
    const args = tool === 'spd-say' ? ['--wait'] : [];
    if (voice) args.push(tool === 'spd-say' ? '-y' : '-v', voice);
    args.push('--', text);
    await run(tool, args, { timeoutMs: 60000 });
  },

  async listApps() {
    const { stdout } = await run('wmctrl', ['-lx']);
    const names = stdout
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[2]?.split('.').pop())
      .filter((n): n is string => Boolean(n));
    return [...new Set(names)].sort();
  },

  async openApp(name) {
    // gtk-launch는 설치된 .desktop 항목만 찾는다. PATH의 스크립트는 실행되지 않는다.
    await run('gtk-launch', ['--', name]);
  },

  async focusApp(name) {
    await run('wmctrl', ['-a', name]);
  },

  async quitApp(name) {
    await run('wmctrl', ['-c', name]);
  },

  async openUrl(url) {
    await run('xdg-open', [webUrl(url)]);
  },

  searchIndex: async () => null,

  async screenshot(file) {
    const tool = required(screenshotTool(), '스크린샷');
    const args: Record<string, string[]> = {
      grim: [file],
      'gnome-screenshot': ['-f', file],
      scrot: [file],
      import: ['-window', 'root', file],
    };
    await run(tool, args[tool], { timeoutMs: 10000 });
  },

  async clipboardRead() {
    const tool = required(clipboardReadTool(), '클립보드 읽기');
    const args: Record<string, string[]> = {
      'wl-paste': ['--no-newline'],
      xclip: ['-selection', 'clipboard', '-o'],
      xsel: ['--clipboard', '--output'],
    };
    return (await run(tool, args[tool])).stdout;
  },

  async clipboardWrite(text) {
    const tool = required(clipboardWriteTool(), '클립보드 쓰기');
    const args: Record<string, string[]> = {
      'wl-copy': [],
      xclip: ['-selection', 'clipboard'],
      xsel: ['--clipboard', '--input'],
    };
    await runWithStdin(tool, args[tool], text);
  },

  async trash(path) {
    await run('gio', ['trash', '--', path]);
  },

  async sampleActivity(): Promise<ActivitySample> {
    const { stdout } = await run('ps', ['-A', '-o', 'pid=,pcpu=,rss=,comm='], { maxBufferKb: 4096 });
    let rxBytes: number | null = null;
    let txBytes: number | null = null;
    try {
      const dev = await fs.readFile('/proc/net/dev', 'utf8');
      rxBytes = 0;
      txBytes = 0;
      for (const line of dev.split('\n').slice(2)) {
        const [iface, rest] = line.split(':');
        if (!rest || iface.trim() === 'lo') continue;
        const cols = rest.trim().split(/\s+/);
        rxBytes += Number(cols[0]) || 0;
        txBytes += Number(cols[8]) || 0;
      }
    } catch {
      /* /proc가 없으면 측정하지 않는다 */
    }
    return { processes: parsePs(stdout), rxBytes, txBytes };
  },

  async battery() {
    try {
      const entries = await fs.readdir('/sys/class/power_supply');
      const bat = entries.find((e) => e.startsWith('BAT'));
      if (!bat) return null;
      const dir = `/sys/class/power_supply/${bat}`;
      const percent = Number((await fs.readFile(`${dir}/capacity`, 'utf8')).trim());
      const status = (await fs.readFile(`${dir}/status`, 'utf8')).trim();
      return { percent, charging: status !== 'Discharging' };
    } catch {
      return null;
    }
  },

  async memoryUsedBytes() {
    try {
      const info = await fs.readFile('/proc/meminfo', 'utf8');
      const kb = (key: string) => Number(info.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] ?? NaN);
      const used = kb('MemTotal') - kb('MemAvailable');
      return Number.isFinite(used) ? used * 1024 : null;
    } catch {
      return null;
    }
  },
};
