import type { ElementType, HTMLAttributes, Ref } from 'react';

export interface MaterialProps extends HTMLAttributes<HTMLElement> {
  /** thin: 보조 표면, regular: 기본 카드, thick: 긴 글과 표 */
  tier?: 'thin' | 'regular' | 'thick';
  as?: ElementType;
  /** 모서리 반경(px). 기본 20 */
  radius?: number;
  ref?: Ref<HTMLElement>;
}

/** 콘텐츠 계층의 표면. 글이 읽히는 것이 우선이며, 카드 안에 카드를 넣지 않는다. */
export function Material({ tier = 'regular', as: Tag = 'div', radius, className, style, ...rest }: MaterialProps) {
  const base = tier === 'regular' ? 'material' : `material-${tier}`;
  return (
    <Tag
      className={`${base}${className ? ` ${className}` : ''}`}
      style={radius === undefined ? style : { borderRadius: radius, ...style }}
      {...rest}
    />
  );
}
