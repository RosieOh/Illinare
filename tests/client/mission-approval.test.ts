import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPROVAL_ARM_MS } from '@/components/mission/useApprovalArmed';

const approval = readFileSync('components/mission/Approval.tsx', 'utf8');
const island = readFileSync('components/shell/Island.tsx', 'utf8');

/** 소스 안에서 어떤 컴포넌트 정의부터 다음 최상위 함수 전까지 잘라 낸다 */
function section(source: string, start: string): string {
  const from = source.indexOf(start);
  expect(from, `${start} not found`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nfunction ', from + start.length);
  const nextExport = source.indexOf('\nexport function ', from + start.length);
  const ends = [next, nextExport].filter((i) => i > 0);
  return source.slice(from, ends.length ? Math.min(...ends) : undefined);
}

describe('승인 UI 안전장치', () => {
  it('제스처가 누를 수 없도록 카드와 시트 본문에 표식이 있다', () => {
    expect(section(approval, 'export function ApprovalFloat')).toContain('data-approval-ui');
    expect(section(approval, 'function ApprovalSheetBody')).toContain('data-approval-ui');
    expect(island).toContain('data-approval-ui');
  });

  it('승인 버튼은 카드가 뜬 뒤 700ms 동안 잠겨 있다', () => {
    expect(APPROVAL_ARM_MS).toBe(700);
    for (const [name, source] of [
      ['ApprovalFloat', section(approval, 'export function ApprovalFloat')],
      ['ApprovalSheetBody', section(approval, 'function ApprovalSheetBody')],
      ['Island ApprovalCard', section(island, 'function ApprovalCard')],
    ] as const) {
      expect(source, name).toContain('useApprovalArmed(approval.id)');
      expect(source, name).toMatch(/disabled=\{[^}]*!armed[^}]*\}/);
    }
  });

  it('거부는 대기 없이 바로 누를 수 있다', () => {
    const float = section(approval, 'export function ApprovalFloat');
    const deny = float.slice(float.indexOf('<Button size="md" variant="secondary"'), float.indexOf('거부'));
    expect(deny).not.toContain('armed');
  });

  it('위험하거나 오염된 요청에는 "앞으로 묻지 않기"를 주지 않는다', () => {
    const body = section(approval, 'function ApprovalSheetBody');
    expect(body).toMatch(/canRemember = approval\.kind === 'tool' && !danger && !approval\.tainted/);
  });

  it('긴 경로의 요약을 잘라 숨기지 않는다', () => {
    const float = section(approval, 'export function ApprovalFloat');
    const line = float.split('\n').find((l) => l.includes('{approval.summary}')) ?? '';
    expect(line).toContain('break-all');
    expect(line).not.toContain('line-clamp');
  });
});
