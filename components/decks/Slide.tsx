'use client';

import './deck.css';

import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { DeckSlide, WallpaperId } from '@/lib/contracts';
import { staticBackground, WALLPAPERS } from '@/components/shell/Wallpaper';
import { barDomain, barGeometry, formatBarValue, SLIDE_HEIGHT, SLIDE_WIDTH, statColumns, statValueSize } from './layout';

export interface SlideAppearance {
  theme: 'light' | 'dark';
  wallpaper: WallpaperId;
}

function BarsBody({ slide }: { slide: Extract<DeckSlide, { type: 'bars' }> }) {
  const domain = barDomain(slide.bars);
  const hasTarget = slide.bars.some((bar) => bar.target !== undefined);
  return (
    <>
      <h2 className="deck-h2">{slide.title}</h2>
      <ul className="deck-bars">
        {slide.bars.map((bar, i) => {
          const { valuePct, targetPct } = barGeometry(bar, domain);
          return (
            <li key={`${bar.label}-${i}`}>
              <div className="deck-bar-head">
                <span className="deck-bar-name">{bar.label}</span>
                <span className="deck-bar-value">{formatBarValue(bar.value, bar.unit)}</span>
                {bar.target !== undefined && <span className="deck-bar-target">목표 {formatBarValue(bar.target, bar.unit)}</span>}
              </div>
              <div className="deck-bar-track" aria-hidden="true">
                <div className="deck-bar-fill" style={{ width: `${valuePct}%` }} />
                {targetPct !== null && <div className="deck-bar-tick" style={{ left: `${targetPct}%` }} />}
              </div>
            </li>
          );
        })}
      </ul>
      {hasTarget && <p className="deck-bars-note">막대 위의 세로선이 목표예요.</p>}
    </>
  );
}

function SlideBody({ slide }: { slide: DeckSlide }) {
  switch (slide.type) {
    case 'title':
      return (
        <div className="flex flex-1 flex-col justify-end pb-6">
          <h1 className="deck-h1">{slide.title}</h1>
          {slide.subtitle && <p className="deck-lede">{slide.subtitle}</p>}
        </div>
      );
    case 'closing':
      return (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <h2 className="deck-h1">{slide.title}</h2>
          {slide.subtitle && <p className="deck-lede">{slide.subtitle}</p>}
        </div>
      );
    case 'bullets':
      return (
        <>
          <h2 className="deck-h2">{slide.title}</h2>
          <ul className="deck-bullets">
            {slide.bullets.map((bullet, i) => (
              <li key={i}>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </>
      );
    case 'stats': {
      const columns = statColumns(slide.stats.length);
      const valueSize = statValueSize(slide.stats.map((stat) => stat.value));
      return (
        <>
          <h2 className="deck-h2">{slide.title}</h2>
          <div className="deck-stats" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {slide.stats.map((stat, i) => (
              <div key={`${stat.label}-${i}`} className="deck-stat" data-row-start={i % columns === 0 ? '' : undefined}>
                <div className="deck-stat-value" style={{ fontSize: valueSize }}>
                  {stat.value}
                </div>
                <div className="deck-stat-label">{stat.label}</div>
                {stat.detail && <div className="deck-stat-detail">{stat.detail}</div>}
              </div>
            ))}
          </div>
        </>
      );
    }
    case 'bars':
      return <BarsBody slide={slide} />;
    case 'timeline': {
      const vertical = slide.items.length > 5;
      return (
        <>
          <h2 className="deck-h2">{slide.title}</h2>
          <ol
            className="deck-timeline"
            data-vertical={vertical ? '' : undefined}
            style={vertical ? undefined : { gridTemplateColumns: `repeat(${slide.items.length}, minmax(0, 1fr))` }}
          >
            {slide.items.map((item, i) => (
              <li key={`${item.when}-${i}`} className="deck-timeline-step">
                <div className="deck-timeline-when">{item.when}</div>
                <div className="deck-timeline-what">{item.what}</div>
              </li>
            ))}
          </ol>
        </>
      );
    }
    case 'quote':
      return (
        <figure className="flex flex-1 flex-col justify-center">
          <blockquote className="deck-quote">{slide.quote}</blockquote>
          {slide.source && <figcaption className="deck-quote-source">{slide.source}</figcaption>}
        </figure>
      );
  }
}

/**
 * 1280×720 슬라이드 한 장. 내용이 길면 글자를 줄여 넘치지 않게 한다.
 * 에이전트가 만든 내용을 잘라내면 안 되므로 숨기지 않고 축소한다.
 */
export const SlideSurface = memo(function SlideSurface({ slide, appearance }: { slide: DeckSlide; appearance: SlideAppearance }) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const fit = () => {
      body.style.zoom = '1';
      const overflow = Math.max(body.scrollHeight / body.clientHeight, body.scrollWidth / body.clientWidth);
      if (overflow > 1.001) body.style.zoom = String(Math.max(0.4, 1 / overflow));
    };
    fit();
    // 글꼴이 늦게 도착하면 줄바꿈이 달라진다.
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) fit();
    });
    return () => {
      alive = false;
    };
  }, [slide]);

  const style = { '--slide-bg': staticBackground(WALLPAPERS[appearance.wallpaper][appearance.theme]) } as CSSProperties;

  return (
    <div className="deck-slide" data-tone={appearance.theme} style={style}>
      <div ref={bodyRef} className="deck-body">
        <SlideBody slide={slide} />
      </div>
    </div>
  );
});

/** 부모 크기에 맞춰 슬라이드를 축소해 가운데 놓는다. */
export const ScaledSlide = memo(function ScaledSlide({
  slide,
  appearance,
  decorative = false,
  className,
}: {
  slide: DeckSlide;
  appearance: SlideAppearance;
  /** 썸네일처럼 이름을 다른 곳에서 주는 경우 */
  decorative?: boolean;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale = box.width && box.height ? Math.min(box.width / SLIDE_WIDTH, box.height / SLIDE_HEIGHT) : 0;
  const left = (box.width - SLIDE_WIDTH * scale) / 2;
  const top = (box.height - SLIDE_HEIGHT * scale) / 2;

  return (
    <div ref={boxRef} className={`relative overflow-hidden ${className ?? ''}`} aria-hidden={decorative ? 'true' : undefined}>
      {scale > 0 && (
        <div style={{ position: 'absolute', left, top, width: SLIDE_WIDTH, height: SLIDE_HEIGHT, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <SlideSurface slide={slide} appearance={appearance} />
        </div>
      )}
    </div>
  );
});
