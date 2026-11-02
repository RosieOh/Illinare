/** 누를 대상 고르기와 승인 차단 규칙. DOM을 쓰지 않아 테스트할 수 있다. */
export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 점에서 사각형까지의 거리. 안쪽이면 0 */
export function rectDistance(rect: RectLike, x: number, y: number): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

export function pickNearest<T extends { rect: RectLike }>(items: readonly T[], x: number, y: number, radius: number): T | null {
  let best: T | null = null;
  let bestDistance = radius;
  for (const item of items) {
    const d = rectDistance(item.rect, x, y);
    if (d <= bestDistance) {
      best = item;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * 제스처는 어떤 경우에도 승인으로 이어지면 안 된다.
 * 승인 UI는 data-approval-ui 로 표시하고, 표시를 빠뜨려도 막히도록 이름으로 한 번 더 거른다.
 */
const APPROVAL_LABEL = /승인|허용|approve|allow/i;

export function looksLikeApproval(label: string | null | undefined): boolean {
  return !!label && APPROVAL_LABEL.test(label);
}
