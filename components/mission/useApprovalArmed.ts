'use client';

import { useEffect, useState } from 'react';

/** 승인 카드가 뜨고 승인 버튼이 눌리기까지의 시간 (ms) */
export const APPROVAL_ARM_MS = 700;

/**
 * 승인 버튼의 대기 시간. 카드가 마운트되거나 다른 승인으로 바뀌면 다시 잠근다.
 * 다음 카드가 같은 자리에 뜨는 순간의 연속 클릭이 내용을 보지 못한 작업을 승인하는 것을 막는다.
 * 비활성 버튼이라 키보드와 스크린 리더에도 같은 규칙이 적용된다.
 */
export function useApprovalArmed(approvalId: string): boolean {
  const [armedId, setArmedId] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setArmedId(approvalId), APPROVAL_ARM_MS);
    return () => clearTimeout(timer);
  }, [approvalId]);
  return armedId === approvalId;
}
