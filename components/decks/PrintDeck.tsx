'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Deck } from '@/lib/contracts';
import { SlideSurface, type SlideAppearance } from './Slide';

/**
 * 인쇄 전용 사본. 평소에는 보이지 않고, 인쇄할 때만 앱 대신 찍힌다.
 * 브라우저의 "PDF로 저장"이 슬라이드마다 가로 한 페이지를 만든다.
 */
export default function PrintDeck({ deck, appearance, onDone }: { deck: Deck; appearance: SlideAppearance; onDone: () => void }) {
  useEffect(() => {
    const previousTitle = document.title;
    // 저장 대화상자의 기본 파일 이름이 된다.
    document.title = deck.title;
    let alive = true;
    const finish = () => {
      if (alive) onDone();
    };
    window.addEventListener('afterprint', finish);
    void document.fonts?.ready.then(() => {
      // 인쇄 레이아웃에서 슬라이드 맞춤이 끝난 뒤 연다.
      requestAnimationFrame(() => {
        if (alive) window.print();
      });
    });
    return () => {
      alive = false;
      window.removeEventListener('afterprint', finish);
      document.title = previousTitle;
    };
  }, [deck.title, onDone]);

  return createPortal(
    <div className="deck-print">
      {deck.slides.map((slide, i) => (
        <section key={i} className="deck-print-page">
          <SlideSurface slide={slide} appearance={appearance} />
        </section>
      ))}
    </div>,
    document.body
  );
}
