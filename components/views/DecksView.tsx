'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileDown, Hand, Play, Presentation, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, Material, Sheet, Skeleton, useToast } from '@/components/glass';
import { sortDecks, slideLabel } from '@/components/decks/layout';
import { consumePresentationRequest, subscribePresentationRequest } from '@/components/decks/intent';
import Presenter from '@/components/decks/Presenter';
import PrintDeck from '@/components/decks/PrintDeck';
import { ScaledSlide, type SlideAppearance } from '@/components/decks/Slide';
import { ViewHeader, ViewScroll, type ViewProps } from '@/components/shell/ViewFrame';
import { useApp } from '@/context/AppContext';
import { useMissions } from '@/context/MissionsContext';
import { api, ClientApiError } from '@/lib/client/api';
import type { Deck } from '@/lib/contracts';

const NEW_DECK_GOAL = '이번 주에 한 일을 정리해서 발표 자료로 만들어 줘. 슬라이드는 6장 안팎으로, 핵심 수치와 다음 할 일을 넣어 줘.';

function deckMeta(deck: Deck): string {
  const date = new Date(deck.updatedAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  return `슬라이드 ${deck.slides.length}장 · ${date}`;
}

export default function DecksView({ active }: ViewProps) {
  const { settings, resolvedTheme, fillComposer, gestureEnabled, setGestureEnabled } = useApp();
  const { missions } = useMissions();
  const toast = useToast();

  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [presenting, setPresenting] = useState<{ deckId: string; index: number } | null>(null);
  const [printing, setPrinting] = useState<Deck | null>(null);
  const [deleting, setDeleting] = useState<Deck | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const appearance = useMemo<SlideAppearance>(
    () => ({ theme: resolvedTheme, wallpaper: settings.wallpaper }),
    [resolvedTheme, settings.wallpaper]
  );

  const load = useCallback(async () => {
    try {
      const { decks: list } = await api.get<{ decks: Deck[] }>('/api/decks');
      setDecks(sortDecks(list));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  // 미션이 새 자료를 만들면 다시 불러온다.
  const deckArtifacts = useMemo(
    () => Object.values(missions).reduce((count, m) => count + m.artifacts.filter((a) => a.kind === 'deck').length, 0),
    [missions]
  );

  useEffect(() => {
    if (active) void load();
  }, [active, deckArtifacts, load]);

  const selected = useMemo(() => {
    if (!decks?.length) return null;
    return decks.find((deck) => deck.id === selectedId) ?? decks[0];
  }, [decks, selectedId]);

  const others = useMemo(() => (decks ?? []).filter((deck) => deck.id !== selected?.id), [decks, selected]);

  const presentingDeck = useMemo(
    () => (presenting ? (decks?.find((deck) => deck.id === presenting.deckId) ?? null) : null),
    [decks, presenting]
  );

  const stopPresenting = useCallback(() => setPresenting(null), []);
  const stopPrinting = useCallback(() => setPrinting(null), []);

  // 팔레트의 "발표 시작"
  useEffect(() => {
    const tryStart = () => {
      if (!active || !decks) return;
      if (!consumePresentationRequest()) return;
      const first = decks.find((deck) => deck.slides.length > 0);
      if (first) {
        setSelectedId(first.id);
        setPresenting({ deckId: first.id, index: 0 });
      } else {
        toast({ title: '발표할 자료가 아직 없어요', description: 'AI로 새 발표를 만들어 보세요.' });
      }
    };
    const timer = setTimeout(tryStart, 0);
    const unsubscribe = subscribePresentationRequest(tryStart);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [active, decks, toast]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.del(`/api/decks/${deleting.id}`);
      setDeleting(null);
      await load();
      toast({ title: '발표 자료를 삭제했어요', tone: 'success' });
    } catch (err) {
      toast({
        tone: 'danger',
        title: '삭제하지 못했어요',
        description: err instanceof ClientApiError ? err.message : '잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setDeleteBusy(false);
    }
  };

  const newDeckButton = (
    <Button variant="primary" icon={Sparkles} className="!rounded-full" onClick={() => fillComposer(NEW_DECK_GOAL)}>
      AI로 새 발표 만들기
    </Button>
  );

  return (
    <ViewScroll>
      <ViewHeader
        title="발표"
        subtitle="에이전트가 만든 자료를 키보드나 손짓으로 발표해요."
        actions={
          <>
            <Button
              variant="secondary"
              icon={Hand}
              className="!rounded-full"
              aria-pressed={gestureEnabled}
              onClick={() => setGestureEnabled(!gestureEnabled)}
            >
              {gestureEnabled ? '제스처 끄기' : '제스처 켜기'}
            </Button>
            {newDeckButton}
          </>
        }
      />

      {failed && !decks && (
        <Material>
          <EmptyState
            icon={RefreshCw}
            title="발표 자료를 불러오지 못했어요"
            description="앱 서버 연결을 확인한 뒤 다시 시도해 주세요."
            action={
              <Button variant="secondary" icon={RefreshCw} onClick={() => void load()}>
                다시 시도
              </Button>
            }
          />
        </Material>
      )}

      {!failed && !decks && (
        <Material className="p-5" aria-busy="true" aria-label="발표 자료를 불러오는 중">
          <Skeleton width="100%" height={340} radius={18} />
          <Skeleton width="40%" height={22} radius={8} className="mt-4" />
        </Material>
      )}

      {decks?.length === 0 && (
        <Material>
          <EmptyState
            icon={Presentation}
            title="아직 발표 자료가 없어요"
            description="주제만 말하면 라이터가 슬라이드를 만들어 줘요."
            action={newDeckButton}
          />
        </Material>
      )}

      {selected && (
        <Material radius={28} className="p-4 sm:p-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
            <button
              type="button"
              aria-label={`${selected.title} 발표 시작`}
              disabled={selected.slides.length === 0}
              className="group relative block rounded-[18px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
              onClick={() => setPresenting({ deckId: selected.id, index: 0 })}
            >
              {selected.slides[0] ? (
                <ScaledSlide
                  slide={selected.slides[0]}
                  appearance={appearance}
                  decorative
                  className="aspect-video w-full rounded-[18px] ring-1 ring-[var(--separator)] transition-transform duration-200 group-hover:scale-[1.008]"
                />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center rounded-[18px] bg-fill-2 text-subhead text-label-2">
                  슬라이드가 없어요
                </div>
              )}
            </button>

            <div className="flex min-w-0 flex-col">
              <div className="flex items-start gap-2">
                <h2 className="min-w-0 flex-1 text-title2 text-label">{selected.title}</h2>
                {selected.sample && <Badge>예시</Badge>}
              </div>
              <p className="mt-1.5 text-subhead text-label-2">{deckMeta(selected)}</p>

              <div className="mt-5 flex flex-col gap-2">
                <Button
                  variant="primary"
                  size="lg"
                  icon={Play}
                  fullWidth
                  disabled={selected.slides.length === 0}
                  className="!rounded-full"
                  onClick={() => setPresenting({ deckId: selected.id, index: 0 })}
                >
                  발표 시작
                </Button>
                <Button
                  variant="secondary"
                  icon={FileDown}
                  fullWidth
                  disabled={selected.slides.length === 0}
                  className="!rounded-full"
                  onClick={() => {
                    toast({ title: '인쇄 창의 대상에서 PDF로 저장을 고르세요', duration: 5000 });
                    setPrinting(selected);
                  }}
                >
                  PDF로 저장
                </Button>
                <Button variant="plain" icon={Trash2} fullWidth className="!rounded-full" onClick={() => setDeleting(selected)}>
                  삭제
                </Button>
              </div>

              <p className="mt-auto pt-4 text-footnote text-label-2">
                발표 중에는 방향키로 넘기고, G로 전체 보기, N으로 메모를 열어요.
              </p>
            </div>
          </div>

          {selected.slides.length > 1 && (
            <ol className="-mx-1 mt-5 flex snap-x gap-3 overflow-x-auto px-1 pb-2" aria-label="슬라이드 목록">
              {selected.slides.map((slide, i) => (
                <li key={i} className="w-[168px] shrink-0 snap-start">
                  <button
                    type="button"
                    aria-label={`${i + 1}번 슬라이드부터 발표: ${slideLabel(slide)}`}
                    className="block w-full rounded-[12px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                    onClick={() => setPresenting({ deckId: selected.id, index: i })}
                  >
                    <ScaledSlide
                      slide={slide}
                      appearance={appearance}
                      decorative
                      className="aspect-video w-full rounded-[12px] ring-1 ring-[var(--separator)]"
                    />
                    <span className="mt-1.5 block truncate text-footnote tabular-nums text-label-2">
                      {i + 1}. {slideLabel(slide)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Material>
      )}

      {others.length > 0 && (
        <section className="mt-7" aria-label="다른 발표 자료">
          <h2 className="mb-3 text-title3 text-label">다른 자료</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((deck) => (
              <li key={deck.id}>
                <button
                  type="button"
                  className="material-regular block w-full rounded-[22px] p-2.5 text-left outline-none transition-transform duration-150 hover:scale-[1.01] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  onClick={() => setSelectedId(deck.id)}
                >
                  {deck.slides[0] ? (
                    <ScaledSlide slide={deck.slides[0]} appearance={appearance} decorative className="aspect-video w-full rounded-[14px]" />
                  ) : (
                    <div className="aspect-video w-full rounded-[14px] bg-fill-2" />
                  )}
                  <span className="mt-2.5 flex items-center gap-2 px-1.5">
                    <span className="min-w-0 flex-1 truncate text-callout font-semibold text-label">{deck.title}</span>
                    {deck.sample && <Badge>예시</Badge>}
                  </span>
                  <span className="mt-0.5 block px-1.5 pb-1 text-footnote text-label-2">{deckMeta(deck)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {presentingDeck && presentingDeck.slides.length > 0 && presenting && (
        <Presenter
          key={presentingDeck.id}
          deck={presentingDeck}
          startIndex={presenting.index}
          appearance={appearance}
          active={active}
          onExit={stopPresenting}
        />
      )}

      {printing && <PrintDeck deck={printing} appearance={appearance} onDone={stopPrinting} />}

      <Sheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="이 발표 자료를 삭제할까요?"
        description={deleting ? `"${deleting.title}"을(를) 지우면 되돌릴 수 없어요.` : undefined}
        width={440}
        footer={
          <>
            <Button variant="secondary" className="!rounded-full" onClick={() => setDeleting(null)}>
              취소
            </Button>
            <Button variant="danger" loading={deleteBusy} className="!rounded-full" onClick={() => void confirmDelete()}>
              삭제
            </Button>
          </>
        }
      >
        <span className="sr-only">삭제를 확인해 주세요.</span>
      </Sheet>
    </ViewScroll>
  );
}
