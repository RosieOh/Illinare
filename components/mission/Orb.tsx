'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { sphereLensMap, supportsLens } from '@/components/glass/displacement';
import type { StepStatus } from '@/lib/contracts';
import { POOL_WALL } from './liquid';

export interface OrbProps {
  /** 지름(px) */
  size: number;
  status: StepStatus | 'idle';
  /** 에이전트 색: 테두리, 바닥 빛, 아이콘에 번진다 */
  tint: string;
  icon: LucideIcon;
  /** 액체 렌더러가 이 구를 찾는 값 */
  poolId: string;
  /** 뒤의 필라멘트를 실제로 꺾는다. 뒤로 지나가는 것이 있는 큰 구에만 켠다 */
  lens?: boolean;
  children?: ReactNode;
  className?: string;
}

/**
 * 액체를 담는 투명한 유리구. 아래부터 순서대로 유리, 액체, 바닥에 모인 빛, 아이콘, 테두리와 빛.
 * 렌즈는 유리 층에서 구 뒤쪽만 꺾는다. 액체는 그 위에 그려지는 벡터라 어떤 해상도에서도 가장자리가 매끈하다.
 * 값은 LiquidLayer가 매 프레임 직접 쓴다.
 * 아이콘은 두 장이 겹쳐 수면에서 색이 바뀐다: 유리 위와 액체 위 어디서든 읽혀야 하기 때문이다.
 */
export function Orb({ size, status, tint, icon: Icon, poolId, lens = false, children, className }: OrbProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const rounded = Math.round(size);
  const iconSize = Math.round(size * 0.32);
  const icon = <Icon size={iconSize} strokeWidth={2} aria-hidden="true" />;

  const [lensMap, setLensMap] = useState<string | null>(null);
  useEffect(() => {
    if (!lens || !supportsLens()) return;
    const frame = requestAnimationFrame(() => setLensMap(sphereLensMap(rounded)));
    return () => cancelAnimationFrame(frame);
  }, [lens, rounded]);
  const refract = lens && lensMap !== null;

  return (
    <span
      className={`orb ${className ?? ''}`}
      data-status={status}
      data-pool-id={poolId}
      data-lens={refract ? '' : undefined}
      style={
        {
          '--orb-size': `${rounded}px`,
          '--orb-tint': tint,
          ...(refract ? { '--orb-refract': `url(#${id}l)` } : null),
        } as React.CSSProperties
      }
    >
      {refract && (
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
          <filter id={`${id}l`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feImage href={lensMap} x="0" y="0" width={rounded} height={rounded} preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={Math.round(rounded * 0.3)} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}
      <span className="orb-cast" aria-hidden="true" />
      <span className="orb-lens" aria-hidden="true" />
      <svg className="orb-liquid" viewBox="-1 -1 2 2" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id={`${id}c`}>
            <circle r={POOL_WALL} />
          </clipPath>
          <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1" data-part="fill" />
          {/* 수면 가까이는 밝고 바닥으로 갈수록 깊어진다 */}
          <linearGradient id={`${id}d`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.2" />
            <stop offset="0.42" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#020617" stopOpacity="0.2" />
          </linearGradient>
          {/* 공 모양의 부피: 벽에 가까울수록 빛이 덜 지나간다 */}
          <radialGradient id={`${id}e`} gradientUnits="userSpaceOnUse" cx="0" cy="-0.1" r={POOL_WALL * 1.06}>
            <stop offset="0.58" stopColor="#020617" stopOpacity="0" />
            <stop offset="1" stopColor="#020617" stopOpacity="0.28" />
          </radialGradient>
          {/* 구를 지난 빛이 액체 아래쪽에 모인다 */}
          <radialGradient id={`${id}g`} gradientUnits="userSpaceOnUse" cx="0" cy="0.72" r="0.62" gradientTransform="translate(0 0.36) scale(1 0.5)">
            <stop className="orb-glow" offset="0" stopColor="#fff" stopOpacity="0.42" />
            <stop className="orb-glow" offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <path id={`${id}b`} data-part="body" />
        </defs>
        <g className="orb-rivers" data-part="rivers" />
        <g clipPath={`url(#${id}c)`}>
          <use href={`#${id}b`} fill={`url(#${id}f)`} />
          <use href={`#${id}b`} fill={`url(#${id}d)`} />
          <use href={`#${id}b`} fill={`url(#${id}e)`} />
          <use href={`#${id}b`} fill={`url(#${id}g)`} />
          <path className="orb-disc" data-part="disc" />
          <path className="orb-front" data-part="front" />
        </g>
      </svg>
      <span className="orb-caustic" aria-hidden="true" />
      <span className="orb-ink orb-ink-dry" aria-hidden="true">
        {icon}
      </span>
      <span className="orb-ink orb-ink-wet" aria-hidden="true">
        {icon}
      </span>
      <span className="orb-rim" aria-hidden="true" />
      <span className="orb-spec" aria-hidden="true" />
      {children}
    </span>
  );
}
