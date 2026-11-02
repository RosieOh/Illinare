'use client';

import { useSyncExternalStore } from 'react';

/**
 * 미션 화면의 선택 상태. 아일랜드의 "자세히"처럼 화면 밖에서도 특정 단계나 승인으로
 * 곧장 데려올 수 있어야 하므로 컴포넌트 바깥 저장소에 둔다.
 */
export interface MissionSelection {
  missionId: string | null;
  stepId: string | null;
  /** 미리보기 시트를 열어 둘 승인 */
  approvalId: string | null;
}

const EMPTY: MissionSelection = { missionId: null, stepId: null, approvalId: null };

let current: MissionSelection = EMPTY;
const listeners = new Set<() => void>();

function set(next: MissionSelection) {
  current = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useMissionSelection(): MissionSelection {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => EMPTY
  );
}

export function selectStep(missionId: string, stepId: string | null) {
  set({ missionId, stepId, approvalId: null });
}

/** 승인 미리보기를 연다. 시트를 닫으면 단계 상세가 아니라 스테이지로 돌아온다. */
export function openApprovalDetails(missionId: string, approvalId: string) {
  set({ missionId, stepId: null, approvalId });
}

/** 다른 화면으로 가면 미션 시트들을 닫는다 (시트는 inert 영역 밖으로 포털된다). */
export function clearSelection() {
  if (current !== EMPTY) set(EMPTY);
}

export function closeApprovalDetails() {
  set({ ...current, approvalId: null });
}
