'use client';

import { useCallback, useRef, useState } from 'react';

/** 요소 크기를 재는 콜백 ref. 패널 크기에 맞춰 스테이지를 다시 배치할 때 쓴다. */
export function useElementSize<T extends HTMLElement>() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setSize((cur) => (cur.width === width && cur.height === height ? cur : { width, height }));
    };
    observer.current = new ResizeObserver(measure);
    observer.current.observe(el);
    measure();
  }, []);

  return [ref, size] as const;
}
