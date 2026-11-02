'use client';

import { useEffect, useRef } from 'react';
import { cursorFrame, subscribeCursor } from '@/context/GestureContext';

/** 유리 레티클. 매 프레임 바뀌므로 React를 거치지 않고 DOM을 직접 고친다. */
export default function GestureCursor() {
  const rootRef = useRef<HTMLDivElement>(null);
  const arcRef = useRef<SVGCircleElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const root = rootRef.current;
      if (!root) return;
      root.style.display = cursorFrame.visible ? 'block' : 'none';
      root.style.transform = `translate3d(${cursorFrame.x}px, ${cursorFrame.y}px, 0)`;
      root.toggleAttribute('data-pinching', cursorFrame.pinching);
      root.toggleAttribute('data-snapped', cursorFrame.snapped);
      root.toggleAttribute('data-holding', cursorFrame.hold > 0.08);
      if (arcRef.current) arcRef.current.style.strokeDashoffset = String(1 - cursorFrame.hold);
      if (labelRef.current && labelRef.current.textContent !== cursorFrame.holdLabel) {
        labelRef.current.textContent = cursorFrame.holdLabel;
      }
    };
    update();
    return subscribeCursor(update);
  }, []);

  return (
    <div ref={rootRef} className="gesture-cursor" style={{ display: 'none' }} aria-hidden="true">
      <div className="gesture-reticle" />
      <svg className="gesture-hold" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r="25" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="3" />
        <circle
          ref={arcRef}
          cx="28"
          cy="28"
          r="25"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1"
          strokeDashoffset="1"
        />
      </svg>
      <div ref={labelRef} className="gesture-hold-label" />
    </div>
  );
}
