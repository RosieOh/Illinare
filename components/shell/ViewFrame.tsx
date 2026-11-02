import type { ReactNode } from 'react';

/** 모든 뷰가 받는 props. active가 false면 값비싼 작업(폴링, 애니메이션)을 멈출 것. */
export interface ViewProps {
  active: boolean;
}

/**
 * 스크롤되는 뷰의 뼈대. 셸(아일랜드, 레일, 컴포저) 크기만큼 비켜서 콘텐츠를 놓고,
 * 스크롤하면 콘텐츠가 유리 아래로 지나간다.
 */
export function ViewScroll({ children, maxWidth = 1200, className }: { children: ReactNode; maxWidth?: number; className?: string }) {
  return (
    <div className="view-scroll">
      <div className={`mx-auto w-full ${className ?? ''}`} style={{ maxWidth }}>
        {children}
      </div>
    </div>
  );
}

/** 스크롤 없이 화면을 꽉 채우는 뷰의 뼈대 (미션 스테이지 등). 안쪽 패널이 각자 스크롤한다. */
export function ViewFixed({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`view-fixed flex min-h-0 flex-col ${className ?? ''}`}>{children}</div>;
}

export function ViewHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-large-title text-label max-sm:text-title1">{title}</h1>
        {subtitle && <p className="mt-1 text-body text-label-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
