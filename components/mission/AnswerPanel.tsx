'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, type MotionStyle } from 'framer-motion';
import {
  CalendarDays,
  ChevronRight,
  Clipboard,
  FileText,
  ListChecks,
  Presentation,
  RotateCcw,
  Settings2,
  Sparkles,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { type MissionArtifact, type MissionErrorCode, type MissionView } from '@/lib/contracts';
import { AgentAvatar, Button, Markdown, spring, useToast } from '@/components/glass';
import { useApp } from '@/context/AppContext';
import { useMissions } from '@/context/MissionsContext';
import { api, ClientApiError } from '@/lib/client/api';
import { formatCost } from '@/lib/client/format';
import { isActive } from '@/lib/missions/reducer';
import { finishedColors } from './liquid';

const ARTIFACT_ICON: Record<MissionArtifact['kind'], LucideIcon> = {
  deck: Presentation,
  note: FileText,
  file: FileText,
  task: ListChecks,
  event: CalendarDays,
};

function ArtifactChip({ artifact }: { artifact: MissionArtifact }) {
  const { navigate } = useApp();
  const toast = useToast();
  const Icon = ARTIFACT_ICON[artifact.kind];

  const open = async () => {
    if (artifact.kind === 'deck') return navigate('decks');
    if (artifact.kind === 'task' || artifact.kind === 'event') return navigate('planner');
    try {
      await navigator.clipboard.writeText(artifact.ref);
      toast({ tone: 'success', title: '경로를 복사했어요', description: artifact.ref });
    } catch {
      toast({ tone: 'info', title: '저장 위치', description: artifact.ref });
    }
  };

  return (
    <button
      type="button"
      onClick={() => void open()}
      title={artifact.ref}
      className="press flex h-8 max-w-full items-center gap-1.5 rounded-full bg-fill-3 px-3 text-subhead font-medium text-label hover:bg-fill-2"
    >
      <Icon size={14} className="shrink-0 text-accent-text" aria-hidden="true" />
      <span className="truncate">{artifact.title}</span>
    </button>
  );
}

export const FAILURE: Record<MissionErrorCode, { title: string; settings?: boolean; retry?: boolean }> = {
  no_api_key: { title: 'API 키가 필요해요', settings: true },
  invalid_api_key: { title: 'API 키를 확인해 주세요', settings: true },
  rate_limited: { title: '요청이 너무 많아요', retry: true },
  overloaded: { title: '지금 모델이 혼잡해요', retry: true },
  budget_exceeded: { title: '비용 상한에 닿아 멈췄어요', settings: true, retry: true },
  refused: { title: '이 요청은 처리할 수 없어요' },
  network: { title: '연결이 끊어졌어요', retry: true },
  internal: { title: '미션을 끝내지 못했어요', retry: true },
};

/** 실패 안내: 무엇이 잘못됐고 무엇을 하면 되는지. 표면 위에 바로 놓는다. */
export function FailureNote({ view }: { view: MissionView }) {
  const { navigate } = useApp();
  const { start } = useMissions();
  const toast = useToast();
  const code = view.error?.code ?? 'internal';
  const meta = FAILURE[code];

  const retry = () =>
    void start(view.goal).catch((err) =>
      toast({ tone: 'danger', title: '다시 시작하지 못했어요', description: err instanceof ClientApiError ? err.message : undefined })
    );

  return (
    <div role="alert">
      <h3 className="text-headline text-danger-text">{meta.title}</h3>
      <p className="mt-0.5 text-callout text-label-2">{view.error?.message ?? '다시 시도해 주세요.'}</p>
      {(meta.settings || meta.retry) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {meta.retry && (
            <Button size="sm" variant="primary" icon={RotateCcw} className="!rounded-full" onClick={retry}>
              다시 시도
            </Button>
          )}
          {meta.settings && (
            <Button size="sm" variant="secondary" icon={Settings2} className="!rounded-full" onClick={() => navigate('settings')}>
              설정 열기
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function PartialOutputs({ view }: { view: MissionView }) {
  const partial = view.stepOrder.map((id) => view.steps[id]).filter((s) => s?.output);
  if (partial.length === 0) return null;
  return (
    <section className="mt-6">
      <h3 className="text-title3 text-label">끝난 단계의 결과</h3>
      <p className="mb-3 text-subhead text-label-2">멈추기 전까지 얻은 내용이에요.</p>
      <div className="space-y-4">
        {partial.map((s) => (
          <div key={s.step.id}>
            <p className="flex items-center gap-1.5 text-callout font-semibold text-label">
              <AgentAvatar agent={s.step.agent} size={20} decorative />
              {s.step.title}
            </p>
            <Markdown className="mt-1">{s.output ?? ''}</Markdown>
          </div>
        ))}
      </div>
    </section>
  );
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|?[-:| ]+\|?\s*$/gm, ' ')
    .replace(/[#*`>_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function AnswerActions({ view }: { view: MissionView }) {
  const { speak } = useApp();
  const { followup } = useMissions();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(view.answer);
      toast({ tone: 'success', title: '결과를 복사했어요' });
    } catch {
      toast({ tone: 'danger', title: '복사하지 못했어요', description: '브라우저의 클립보드 권한을 확인해 주세요.' });
    }
  };

  const saveRoutine = async () => {
    setSaving(true);
    try {
      await api.post('/api/routines', { title: view.title, goal: view.goal, icon: 'Sparkles' });
      toast({ tone: 'success', title: '루틴으로 저장했어요', description: '명령 찾기와 오늘 화면에서 바로 실행할 수 있어요.' });
    } catch (err) {
      toast({ tone: 'danger', title: '저장하지 못했어요', description: err instanceof ClientApiError ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const toSlides = async () => {
    setAsking(true);
    try {
      await followup(view.id, '이 결과를 발표 자료로 만들어 주세요.');
    } catch (err) {
      toast({ tone: 'danger', title: '요청하지 못했어요', description: err instanceof ClientApiError ? err.message : undefined });
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="-ml-3 flex flex-wrap items-center gap-1">
      <Button size="sm" variant="plain" icon={Clipboard} onClick={() => void copy()}>
        복사
      </Button>
      <Button size="sm" variant="plain" icon={Volume2} onClick={() => speak(stripMarkdown(view.answer).slice(0, 2000))}>
        음성으로 듣기
      </Button>
      <Button size="sm" variant="plain" icon={Sparkles} loading={saving} onClick={() => void saveRoutine()}>
        루틴으로 저장
      </Button>
      <Button size="sm" variant="plain" icon={Presentation} loading={asking} disabled={asking} onClick={() => void toSlides()}>
        슬라이드로 만들기
      </Button>
    </div>
  );
}

/** 토큰과 비용. 경과 시간은 머리글에만 있고, 데모에는 토큰도 비용도 없다. */
function StatsLine({ view }: { view: MissionView }) {
  const input = view.usage.inputTokens + view.usage.cacheReadTokens + view.usage.cacheWriteTokens;
  const tokens = input + view.usage.outputTokens;
  return (
    <span className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-0.5">
      <span>토큰 {tokens.toLocaleString()}</span>
      <span>
        {/* 상한은 턴마다 다시 정해지므로 이번 턴 비용과 견준다 */}
        {view.turns.length > 0 ? '이번 지시 비용' : '비용'} {formatCost(Math.max(0, view.usage.costUsd - (view.turnStartCostUsd ?? 0)))} / 상한 {formatCost(view.budgetUsd)}
      </span>
    </span>
  );
}

/**
 * 읽는 표면. 결과 구가 그대로 펼쳐져 이것이 된다 (layoutId 공유).
 * 거의 불투명하고, 긴 글을 읽을 수 있는 폭으로 제한한다. 높이는 내용을 따라가고 넘치면 안쪽만 스크롤한다.
 * 위쪽 가장자리에 결과 구와 같은 색이 번진다. 후속 지시는 아래로 이어 붙는다.
 */
export default function AnswerSurface({ view, morphId, scrollInside }: { view: MissionView; morphId: string; scrollInside: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const streaming = view.status === 'synthesizing' && view.answer.length > 0;

  // 사용자가 위로 올려 읽는 중이 아니면 스트리밍을 따라 내려간다.
  useEffect(() => {
    const el = scroller.current;
    if (el && scrollInside && pinned.current && streaming) el.scrollTop = el.scrollHeight;
  }, [view.answer, streaming, scrollInside]);

  // 진행 중에 표면 높이가 바뀌면(승인 카드가 뜨면) 읽던 끝을 놓치지 않는다.
  const running = isActive(view.status);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !scrollInside || !running) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollInside, running]);

  const failed = view.status === 'failed';
  const waitingForTeam = isActive(view.status) && !view.answer;
  const hasActions = Boolean(view.answer) && view.status === 'done';
  const hues = finishedColors(view);
  const rim = hues.length > 1 ? hues.join(', ') : `${hues[0] ?? 'var(--accent)'}, ${hues[0] ?? 'var(--accent)'}`;

  return (
    <motion.section
      layoutId={morphId}
      layoutDependency={morphId}
      className={`answer-surface flex min-w-0 flex-col ${scrollInside ? 'min-h-0' : ''}`}
      style={{ borderRadius: 26, '--surface-rim': `linear-gradient(90deg, ${rim})` } as MotionStyle}
      transition={{ layout: spring.gentle }}
      aria-label="미션 결과"
    >
      <motion.div
        className={`flex min-h-0 flex-col ${scrollInside ? 'overflow-hidden' : ''}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.32, delay: 0.26 }}
      >
        <div
          ref={scroller}
          className={`answer-scroll min-h-0 ${scrollInside ? 'overflow-y-auto' : ''}`}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
        >
          <div className="answer-measure">
            {view.turns.map((turn, i) => (
              <section key={i} className="mb-7 border-b-[0.5px] border-separator pb-7">
                <p className="mb-2 flex items-start gap-1.5 text-callout font-semibold text-label">
                  <ChevronRight size={15} className="mt-[3px] shrink-0 text-label-2" aria-hidden="true" />
                  <span>{turn.goal}</span>
                </p>
                {turn.answer ? <Markdown>{turn.answer}</Markdown> : <p className="text-subhead text-label-2">답변 없이 끝났어요.</p>}
              </section>
            ))}
            {view.turns.length > 0 && (
              <p className="mb-3 flex items-start gap-1.5 text-callout font-semibold text-label">
                <ChevronRight size={15} className="mt-[3px] shrink-0 text-label-2" aria-hidden="true" />
                <span>{view.goal}</span>
              </p>
            )}

            {waitingForTeam && (
              <p className="text-callout text-label-2" role="status">
                {view.status === 'planning' ? '지휘자가 일을 나누고 있어요.' : '팀이 일하고 있어요. 위의 구를 누르면 단계별 내용을 볼 수 있어요.'}
              </p>
            )}

            {failed && <FailureNote view={view} />}
            {failed && <PartialOutputs view={view} />}

            {view.answer && (
              <div className={streaming ? 'answer-stream' : undefined}>
                <Markdown>{view.answer}</Markdown>
              </div>
            )}

            {view.artifacts.length > 0 && (
              <section className="mt-5 flex flex-wrap gap-1.5" aria-label="만들어진 항목">
                {view.artifacts.map((artifact) => (
                  <ArtifactChip key={`${artifact.kind}:${artifact.id}`} artifact={artifact} />
                ))}
              </section>
            )}
          </div>
        </div>
        {(view.mode === 'live' || hasActions) && (
          <footer className="answer-footer flex shrink-0 flex-col border-t-[0.5px] border-separator text-footnote text-label-2">
            {view.mode === 'live' && <StatsLine view={view} />}
            {hasActions && <AnswerActions view={view} />}
          </footer>
        )}
      </motion.div>
    </motion.section>
  );
}
