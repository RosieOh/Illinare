'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Hand,
  LayoutGrid,
  Maximize,
  Minimize,
  NotebookText,
  TimerReset,
  X,
} from 'lucide-react';
import { IconButton, LiquidGlass, Material, spring } from '@/components/glass';
import { useApp } from '@/context/AppContext';
import { subscribeSwipe } from '@/context/GestureContext';
import { formatElapsed } from '@/lib/client/format';
import type { Deck } from '@/lib/contracts';
import { useNow } from '@/utils/useNow';
import { clampIndex, presenterAction, slideLabel } from './layout';
import { ScaledSlide, type SlideAppearance } from './Slide';

const TOOLBAR_IDLE_MS = 2600;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function NotesPane({ deck, index, startedAt, onReset }: { deck: Deck; index: number; startedAt: number; onReset: () => void }) {
  const now = useNow();
  const slide = deck.slides[index];
  const next = deck.slides[index + 1];
  return (
    <Material tier="thick" radius={22} className="flex w-[360px] shrink-0 flex-col gap-4 p-5 max-[820px]:h-[42%] max-[820px]:w-auto">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-title2 font-semibold tabular-nums text-label" role="timer" aria-label="발표 경과 시간">
          {formatElapsed(now && now > startedAt ? now - startedAt : 0)}
        </span>
        <IconButton icon={TimerReset} label="타이머 다시 시작" size="sm" onClick={onReset} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <h2 className="text-footnote font-semibold text-label-2">발표 메모</h2>
        <p className="mt-1.5 whitespace-pre-wrap text-body text-label">{slide.note || '이 슬라이드에는 메모가 없어요.'}</p>
      </div>
      <div className="shrink-0">
        <h2 className="text-footnote font-semibold text-label-2">다음 슬라이드</h2>
        <p className="mt-1 truncate text-subhead text-label">{next ? slideLabel(next) : '마지막 슬라이드예요.'}</p>
      </div>
    </Material>
  );
}

function Overview({
  deck,
  appearance,
  current,
  onPick,
}: {
  deck: Deck;
  appearance: SlideAppearance;
  current: number;
  onPick: (index: number) => void;
}) {
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentRef.current?.focus({ preventScroll: false });
  }, []);
  return (
    <div className="absolute inset-0 z-20 overflow-y-auto p-6 sm:p-10" style={{ background: 'var(--scrim)' }}>
      <Material tier="thick" radius={28} className="mx-auto max-w-6xl p-5 sm:p-7">
        <h2 className="text-title3 text-label">슬라이드 전체 보기</h2>
        <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {deck.slides.map((slide, i) => (
            <li key={i}>
              <button
                ref={i === current ? currentRef : undefined}
                type="button"
                aria-label={`${i + 1}번 슬라이드: ${slideLabel(slide)}`}
                aria-current={i === current ? 'true' : undefined}
                className="group block w-full text-left outline-none"
                onClick={() => onPick(i)}
              >
                <ScaledSlide
                  slide={slide}
                  appearance={appearance}
                  decorative
                  className={`aspect-video w-full rounded-[14px] group-focus-visible:ring-[3px] group-focus-visible:ring-[var(--label)] ${i === current ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-[var(--separator)]'}`}
                />
                <span className="mt-1.5 block truncate text-footnote tabular-nums text-label-2">
                  {i + 1}. {slideLabel(slide)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Material>
    </div>
  );
}

export default function Presenter({
  deck,
  startIndex,
  appearance,
  active,
  onExit,
}: {
  deck: Deck;
  startIndex: number;
  appearance: SlideAppearance;
  /** 발표 뷰가 화면에 있는가. 단축키로 다른 뷰로 가면 발표를 끝낸다 */
  active: boolean;
  onExit: () => void;
}) {
  const { setChromeHidden, gestureEnabled, setGestureEnabled } = useApp();
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const [{ index, direction }, setPosition] = useState({ index: clampIndex(startIndex, deck.slides.length), direction: 0 });
  const [overview, setOverview] = useState(false);
  const [notes, setNotes] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen] = useState(() => typeof document !== 'undefined' && document.fullscreenEnabled === true);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** 도구 막대로 전체 화면만 끈 경우에는 발표를 끝내지 않는다 */
  const leavingFullscreenByButton = useRef(false);

  const total = deck.slides.length;
  const slide = deck.slides[index];

  const go = useCallback(
    (target: number) => {
      setPosition((current) => {
        const next = clampIndex(target, total);
        return next === current.index ? current : { index: next, direction: next > current.index ? 1 : -1 };
      });
    },
    [total]
  );
  const step = useCallback(
    (delta: number) => {
      setPosition((current) => {
        const next = clampIndex(current.index + delta, total);
        return next === current.index ? current : { index: next, direction: delta };
      });
    },
    [total]
  );

  const revealToolbar = useCallback(() => {
    setToolbarVisible(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setToolbarVisible(false), TOOLBAR_IDLE_MS);
  }, []);

  // 셸을 숨기고, 전체 화면을 요청한다. 거부되면 창 안에서 그대로 발표한다.
  useEffect(() => {
    setChromeHidden(true);
    rootRef.current?.focus({ preventScroll: true });
    if (document.fullscreenEnabled) {
      document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
    idleTimer.current = setTimeout(() => setToolbarVisible(false), TOOLBAR_IDLE_MS);
    return () => {
      clearTimeout(idleTimer.current);
      setChromeHidden(false);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
    };
  }, [setChromeHidden]);

  // 브라우저의 Esc가 전체 화면을 끄면 발표도 함께 끝낸다.
  useEffect(() => {
    let wasFullscreen = false;
    const onChange = () => {
      const isFull = !!document.fullscreenElement;
      setFullscreen(isFull);
      if (wasFullscreen && !isFull && !leavingFullscreenByButton.current) onExit();
      leavingFullscreenByButton.current = false;
      wasFullscreen = isFull;
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [onExit]);

  useEffect(() => {
    if (!active) onExit();
  }, [active, onExit]);

  // 키는 이 화면이 열려 있는 동안에만 듣는다. 숨겨진 뷰가 방향키를 가로채던 예전 버그가 다시 생기지 않게 한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 팔레트 같은 시트가 위에 열려 있으면 키는 그쪽 몫이다.
      if (document.querySelector('[role="dialog"]')) return;
      const action = presenterAction({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        typing: isTyping(e.target),
      });
      if (!action) return;
      // 버튼에 포커스가 있을 때 스페이스는 그 버튼을 누르는 키로 남겨 둔다.
      if (e.key === ' ' && e.target instanceof HTMLElement && e.target.closest('button, a')) return;
      if (overview && action !== 'exit' && action !== 'overview') return;
      e.preventDefault();
      e.stopPropagation();
      revealToolbar();
      switch (action) {
        case 'next':
          step(1);
          break;
        case 'prev':
          step(-1);
          break;
        case 'first':
          go(0);
          break;
        case 'last':
          go(total - 1);
          break;
        case 'overview':
          setOverview((value) => !value);
          break;
        case 'notes':
          setNotes((value) => !value);
          break;
        case 'exit':
          if (overview) setOverview(false);
          else onExit();
          break;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, onExit, overview, revealToolbar, step, total]);

  // 왼쪽으로 쓸면 다음, 오른쪽으로 쓸면 이전. 터치 화면에서 넘기는 방향과 같다.
  useEffect(() => subscribeSwipe((swipe) => step(swipe === 'left' ? 1 : -1)), [step]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      leavingFullscreenByButton.current = true;
      document.exitFullscreen?.().catch(() => undefined);
    } else {
      document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
  };

  const offset = reduce ? 0 : 56;

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      role="region"
      aria-roledescription="발표"
      aria-label={deck.title}
      className="fixed inset-0 z-[65] flex gap-3 outline-none max-[820px]:flex-col"
      style={{ background: 'var(--slide-stage, #05070d)', cursor: toolbarVisible ? undefined : 'none', padding: notes ? 12 : 0 }}
      onPointerMove={revealToolbar}
    >
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="presenter-stage">
        <AnimatePresence initial={false} custom={direction}>
          <motion.div
            key={index}
            custom={direction}
            className="absolute inset-0"
            variants={{
              enter: (d: number) => ({ x: d * offset, opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit: (d: number) => ({ x: d * -offset, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={reduce ? { duration: 0 } : spring.gentle}
          >
            <ScaledSlide slide={slide} appearance={appearance} className="h-full w-full" />
          </motion.div>
        </AnimatePresence>

        {/* 누르는 영역. 왼쪽 30%는 이전, 나머지는 다음. 키보드는 방향키를 쓰므로 탭 순서에서 뺀다. */}
        <button
          type="button"
          tabIndex={-1}
          aria-label="이전 슬라이드"
          disabled={index === 0}
          className="absolute inset-y-0 left-0 w-[30%] cursor-w-resize outline-none disabled:cursor-default"
          style={{ cursor: toolbarVisible ? undefined : 'none' }}
          onClick={() => step(-1)}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="다음 슬라이드"
          disabled={index === total - 1}
          className="absolute inset-y-0 right-0 w-[70%] cursor-e-resize outline-none disabled:cursor-default"
          style={{ cursor: toolbarVisible ? undefined : 'none' }}
          onClick={() => step(1)}
        />

        <div
          className="absolute left-0 top-0 h-[2px] bg-[var(--accent)]"
          style={{ width: `${((index + 1) / total) * 100}%`, transition: reduce ? undefined : 'width 260ms cubic-bezier(0.2, 0.9, 0.3, 1)' }}
          role="progressbar"
          aria-label="발표 진행"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
        />

        <p className="sr-only" aria-live="polite">
          {index + 1}번 슬라이드, 전체 {total}장: {slideLabel(slide)}
        </p>

        <div
          className="absolute inset-x-0 bottom-5 z-10 flex justify-center px-3"
          style={{
            opacity: toolbarVisible ? 1 : 0,
            pointerEvents: toolbarVisible ? undefined : 'none',
            transition: reduce ? undefined : 'opacity 200ms ease',
          }}
          onFocusCapture={revealToolbar}
        >
          <LiquidGlass radius={26} tint="thick" className="flex items-center gap-0.5 p-1.5" role="toolbar" aria-label="발표 도구">
            <IconButton icon={ChevronLeft} label="이전 슬라이드" size="sm" disabled={index === 0} onClick={() => step(-1)} />
            <span className="min-w-[56px] text-center text-footnote font-medium tabular-nums text-label">
              {index + 1} / {total}
            </span>
            <IconButton icon={ChevronRight} label="다음 슬라이드" size="sm" disabled={index === total - 1} onClick={() => step(1)} />
            <span className="mx-1 h-5 w-px bg-[var(--separator)]" aria-hidden="true" />
            <IconButton icon={LayoutGrid} label="전체 보기 (G)" size="sm" onClick={() => setOverview((value) => !value)} />
            <IconButton icon={NotebookText} label="발표 메모 (N)" size="sm" onClick={() => setNotes((value) => !value)} />
            <IconButton
              icon={Hand}
              label={gestureEnabled ? '제스처 끄기' : '제스처 켜기'}
              size="sm"
              variant={gestureEnabled ? 'filled' : 'plain'}
              onClick={() => setGestureEnabled(!gestureEnabled)}
            />
            {canFullscreen && (
              <IconButton
                icon={fullscreen ? Minimize : Maximize}
                label={fullscreen ? '전체 화면 끄기' : '전체 화면'}
                size="sm"
                onClick={toggleFullscreen}
              />
            )}
            <IconButton icon={X} label="발표 끝내기 (Esc)" size="sm" onClick={onExit} />
          </LiquidGlass>
        </div>

        {overview && (
          <Overview
            deck={deck}
            appearance={appearance}
            current={index}
            onPick={(i) => {
              go(i);
              setOverview(false);
              rootRef.current?.focus({ preventScroll: true });
            }}
          />
        )}
      </div>

      {notes && <NotesPane deck={deck} index={index} startedAt={startedAt} onReset={() => setStartedAt(Date.now())} />}
    </div>,
    document.body
  );
}
