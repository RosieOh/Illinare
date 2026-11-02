import type { Transition } from 'framer-motion';

/** 스프링 프리셋 — 앱 전체의 모션 문법. 새 값을 만들지 말고 여기서 고른다. */
export const spring = {
  /** 선택 표시, 토글처럼 손끝에 바로 반응해야 하는 것 */
  snappy: { type: 'spring', stiffness: 520, damping: 38, mass: 0.9 },
  /** 아일랜드, 시트처럼 크기가 바뀌는 큰 표면 */
  morph: { type: 'spring', stiffness: 420, damping: 36, mass: 1 },
  /** 들어오는 콘텐츠 */
  gentle: { type: 'spring', stiffness: 380, damping: 34, mass: 1 },
} satisfies Record<string, Transition>;
