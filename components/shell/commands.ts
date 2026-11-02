'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * 명령 팔레트 레지스트리. 뷰는 useRegisterCommands로 자기 명령을 올린다.
 * 넘기는 배열은 useMemo로 고정할 것 (바뀔 때마다 다시 등록된다).
 */
export interface Command {
  id: string;
  title: string;
  subtitle?: string;
  /** 묶음 이름: 이동, 동작, 루틴, 최근 미션 또는 뷰 이름 */
  group: string;
  icon?: LucideIcon;
  /** 검색에만 쓰는 추가 단어 */
  keywords?: string[];
  /** 표시용 단축키 (예: 'Ctrl 1') */
  shortcut?: string;
  run: () => void;
}

const entries = new Map<symbol, Command[]>();
const listeners = new Set<() => void>();
let snapshot: Command[] = [];

function publish() {
  snapshot = Array.from(entries.values()).flat();
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const EMPTY: Command[] = [];

export function useCommands(): Command[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY
  );
}

export function useRegisterCommands(commands: Command[]) {
  useEffect(() => {
    const token = Symbol('commands');
    entries.set(token, commands);
    publish();
    return () => {
      entries.delete(token);
      publish();
    };
  }, [commands]);
}
