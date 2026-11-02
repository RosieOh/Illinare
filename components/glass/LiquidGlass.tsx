'use client';

import { useCallback, useEffect, useId, useRef, useState, type HTMLAttributes, type Ref } from 'react';
import { lensAssets, supportsLens, type LensAssets } from './displacement';

export interface LiquidGlassProps extends HTMLAttributes<HTMLDivElement> {
  /** 모서리 반경(px). 안쪽 요소는 radius - padding 으로 맞춘다 */
  radius?: number;
  /** 가장자리 굴절. 콘텐츠가 아래로 지나가는 표면에만 켠다 (화면당 2~3개) */
  refract?: boolean;
  /** 굴절 폭(px) */
  bezel?: number;
  /** 굴절 세기 (feDisplacementMap scale) */
  strength?: number;
  /** 포인터를 따라오는 빛 */
  interactive?: boolean;
  /** 눌렀을 때 살짝 작아지는 반응 (버튼처럼 쓰는 표면만) */
  pressable?: boolean;
  /** 'default' 일반, 'sheet' 어두운 막 위의 짧은 표면, 'thick' 글이 많은 표면, 'clear' 사진 위 컨트롤 */
  tint?: 'default' | 'sheet' | 'thick' | 'clear';
  ref?: Ref<HTMLDivElement>;
}

interface Lens extends LensAssets {
  width: number;
  height: number;
}

/**
 * 기능 계층(아일랜드, 레일, 컴포저 등)의 유리 표면.
 * 유리 위에 유리를 쌓지 말 것. 안쪽 표면은 fill 토큰을 쓴다.
 */
export function LiquidGlass({
  radius = 26,
  refract = false,
  bezel = 16,
  strength = 40,
  interactive = false,
  pressable = false,
  tint = 'default',
  className,
  style,
  children,
  onPointerMove,
  ref,
  ...rest
}: LiquidGlassProps) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const rawId = useId();
  const filterId = `lg${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const [lens, setLens] = useState<Lens | null>(null);

  const setNode = useCallback(
    (el: HTMLDivElement | null) => {
      nodeRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref]
  );

  // 크기가 안정된 뒤에만 렌즈를 다시 계산한다. 변하는 동안은 블러만 남겨 프레임을 지킨다.
  useEffect(() => {
    const el = nodeRef.current;
    if (!el || !refract || !supportsLens()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width < 8 || box.height < 8) return;
      el.setAttribute('data-morphing', '');
      clearTimeout(timer);
      timer = setTimeout(() => {
        const width = Math.round(el.offsetWidth);
        const height = Math.round(el.offsetHeight);
        const assets = lensAssets({ width, height, radius, bezel });
        setLens(assets ? { ...assets, width, height } : null);
        el.removeAttribute('data-morphing');
      }, 140);
    });
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [refract, radius, bezel]);

  return (
    <div
      ref={setNode}
      className={`liquid${className ? ` ${className}` : ''}`}
      data-tint={tint === 'default' ? undefined : tint}
      data-interactive={interactive ? '' : undefined}
      data-pressable={pressable ? '' : undefined}
      data-lens={refract && lens ? '' : undefined}
      style={
        {
          '--lg-radius': `${radius}px`,
          ...(refract && lens ? { '--lg-lens': `url(#${filterId})`, '--lg-mask': `url(${lens.mask})` } : null),
          ...style,
        } as React.CSSProperties
      }
      onPointerMove={(e) => {
        if (interactive) {
          const box = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty('--mx', `${e.clientX - box.left}px`);
          e.currentTarget.style.setProperty('--my', `${e.clientY - box.top}px`);
        }
        onPointerMove?.(e);
      }}
      {...rest}
    >
      {refract && lens && (
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
          <filter id={filterId} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feImage
              href={lens.map}
              x="0"
              y="0"
              width={lens.width}
              height={lens.height}
              preserveAspectRatio="none"
              result="map"
            />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={strength} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}
      {refract && lens && <span className="liquid-lens" aria-hidden="true" />}
      <span className="liquid-backdrop" aria-hidden="true" />
      <span className="liquid-spec" aria-hidden="true" />
      <span className="liquid-edge" aria-hidden="true" />
      {children}
    </div>
  );
}
