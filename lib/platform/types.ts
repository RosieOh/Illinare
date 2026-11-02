/** OS별 기능 구현이 공통으로 따르는 인터페이스. 없는 기능은 capability로 숨긴다. */
export type Capability =
  | 'volume'
  | 'darkMode'
  | 'lock'
  | 'sleep'
  | 'notify'
  | 'say'
  | 'listApps'
  | 'openApp'
  | 'focusApp'
  | 'quitApp'
  | 'openUrl'
  | 'screenshot'
  | 'clipboardRead'
  | 'clipboardWrite'
  | 'trash';

export interface RawProcess {
  pid: number;
  name: string;
  /** Windows처럼 누적 CPU 시간만 알 수 있으면 cpuSec, 아니면 cpuPct */
  cpuSec?: number;
  cpuPct?: number;
  memMb: number;
}

export interface ActivitySample {
  processes: RawProcess[];
  /** 누적 수신 바이트. 측정할 수 없으면 null */
  rxBytes: number | null;
  txBytes: number | null;
}

export interface Platform {
  id: 'darwin' | 'win32' | 'linux';
  has(capability: Capability): boolean;
  /** 화면에 표시할 OS 이름 */
  osLabel(): string;

  getVolume(): Promise<number>;
  setVolume(level: number): Promise<void>;
  getDarkMode(): Promise<boolean>;
  setDarkMode(enabled: boolean): Promise<void>;
  lockScreen(): Promise<void>;
  sleep(): Promise<void>;
  notify(input: { title: string; body?: string; sound?: string }): Promise<void>;
  say(input: { text: string; voice?: string }): Promise<void>;

  listApps(): Promise<string[]>;
  openApp(name: string): Promise<void>;
  focusApp(name: string): Promise<void>;
  quitApp(name: string): Promise<void>;
  openUrl(url: string): Promise<void>;

  /** OS 색인으로 검색. 색인이 없는 OS는 null을 돌려주고 호출자가 직접 순회한다. */
  searchIndex(query: string, limit: number): Promise<string[] | null>;
  screenshot(file: string): Promise<void>;
  clipboardRead(): Promise<string>;
  clipboardWrite(text: string): Promise<void>;
  /** 파일이나 폴더를 OS 휴지통으로 보낸다 */
  trash(path: string): Promise<void>;

  sampleActivity(): Promise<ActivitySample>;
  battery(): Promise<{ percent: number; charging: boolean } | null>;
  /** os.freemem()이 부정확한 OS에서 실제 사용 중인 메모리를 돌려준다. 모르면 null */
  memoryUsedBytes(): Promise<number | null>;
}

export class CapabilityError extends Error {
  constructor(what: string) {
    super(`이 컴퓨터에서는 ${what} 기능을 사용할 수 없습니다.`);
    this.name = 'CapabilityError';
  }
}
