'use client';

import { useEffect, useState } from 'react';
import { Brain, Play, Repeat, Trash2 } from 'lucide-react';
import type { MemoryItem, Routine } from '@/lib/contracts';
import { Badge, Button, EmptyState, IconButton, Skeleton, TextArea, TextField, useToast } from '@/components/glass';
import { useApp } from '@/context/AppContext';
import { useMissions } from '@/context/MissionsContext';
import { api, ClientApiError } from '@/lib/client/api';
import { Group } from './shared';

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ClientApiError ? err.message : fallback;
}

/** 목록을 한 번 불러오고 다시 시도할 수 있게 하는 공통 상태 */
function useList<T>(url: string, pick: (data: unknown) => T[]) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .get<unknown>(url)
      .then((data) => {
        if (!alive) return;
        setItems(pick(data));
        setError(null);
      })
      .catch((err) => {
        if (alive) setError(messageOf(err, '목록을 불러오지 못했어요.'));
      });
    return () => {
      alive = false;
    };
    // pick은 모듈 수준 함수만 넘긴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, attempt]);

  return { items, setItems, error, retry: () => setAttempt((n) => n + 1) };
}

function ListLoading() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="목록을 불러오는 중">
      <Skeleton height={40} radius={12} />
      <Skeleton height={40} radius={12} />
    </div>
  );
}

// ─── 기억 ─────────────────────────────────────────────────────
const pickMemory = (data: unknown) => (data as { items: MemoryItem[] }).items;

export function MemorySection() {
  const toast = useToast();
  const { items, setItems, error, retry } = useList<MemoryItem>('/api/memory', pickMemory);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setAddError(null);
    try {
      const item = await api.post<MemoryItem>('/api/memory', { text });
      setItems((cur) => [item, ...(cur ?? [])]);
      setDraft('');
    } catch (err) {
      setAddError(messageOf(err, '저장하지 못했어요.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.del(`/api/memory/${id}`);
      setItems((cur) => (cur ?? []).filter((m) => m.id !== id));
    } catch (err) {
      toast({ tone: 'danger', title: '지우지 못했어요', description: messageOf(err, '') || undefined });
    }
  };

  return (
    <div className="space-y-5">
      <Group>
        <p className="text-subhead text-label-2">
          여기 적은 내용은 미션을 실행할 때마다 Anthropic API로 함께 보내요. 비밀번호나 계좌번호처럼 민감한 정보는 적지 마세요.
        </p>
      </Group>

      <Group>
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <TextField
            aria-label="새 기억"
            placeholder="예: 보고서는 표를 먼저 보여줘"
            maxLength={500}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            error={addError}
            wrapperClassName="min-w-[220px] flex-1"
          />
          <Button type="submit" variant="primary" loading={busy} disabled={!draft.trim()}>
            기억하기
          </Button>
        </form>
      </Group>

      <Group>
        {!items && !error && <ListLoading />}
        {!items && error && (
          <EmptyState compact icon={Brain} title="기억을 불러오지 못했어요" description={error} action={<Button onClick={retry}>다시 시도</Button>} />
        )}
        {items?.length === 0 && (
          <EmptyState compact icon={Brain} title="아직 기억이 없어요" description="선호하는 방식이나 자주 쓰는 정보를 적어 두면 미션마다 반영돼요." />
        )}
        {items && items.length > 0 && (
          <ul className="divide-y divide-separator">
            {items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-callout break-words text-label">{item.text}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge tone={item.source === 'agent' ? 'accent' : 'neutral'}>{item.source === 'agent' ? '에이전트가 저장' : '직접 입력'}</Badge>
                    <span className="text-footnote text-label-2 tabular-nums">
                      {new Date(item.createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
                    </span>
                  </div>
                </div>
                <IconButton icon={Trash2} label="이 기억 지우기" onClick={() => void remove(item.id)} />
              </li>
            ))}
          </ul>
        )}
      </Group>
    </div>
  );
}

// ─── 루틴 ─────────────────────────────────────────────────────
const pickRoutines = (data: unknown) => (data as { routines: Routine[] }).routines;

export function RoutinesSection() {
  const toast = useToast();
  const { navigate } = useApp();
  const { start } = useMissions();
  const { items, setItems, error, retry } = useList<Routine>('/api/routines', pickRoutines);
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setAddError(null);
    try {
      const routine = await api.post<Routine>('/api/routines', { title: title.trim(), goal: goal.trim() });
      setItems((cur) => [routine, ...(cur ?? [])]);
      setTitle('');
      setGoal('');
    } catch (err) {
      setAddError(messageOf(err, '저장하지 못했어요.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.del(`/api/routines/${id}`);
      setItems((cur) => (cur ?? []).filter((r) => r.id !== id));
    } catch (err) {
      toast({ tone: 'danger', title: '지우지 못했어요', description: messageOf(err, '') || undefined });
    }
  };

  const run = async (routine: Routine) => {
    setRunningId(routine.id);
    try {
      await start(routine.goal);
      navigate('missions');
    } catch (err) {
      toast({ tone: 'danger', title: '미션을 시작하지 못했어요', description: messageOf(err, '') || undefined });
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="space-y-5">
      <Group>
        <p className="text-subhead text-label-2">자주 맡기는 일을 저장해 두고 한 번에 실행해요. 지금은 직접 실행할 때만 돌아가요.</p>
      </Group>

      <Group title="새 루틴">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <TextField label="이름" placeholder="아침 브리핑" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />
          <TextArea
            label="맡길 일"
            rows={3}
            placeholder="오늘 일정과 할 일을 보고 우선순위를 정리해 줘"
            maxLength={8000}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            error={addError}
          />
          <Button type="submit" variant="primary" loading={busy} disabled={!title.trim() || !goal.trim()}>
            루틴 저장
          </Button>
        </form>
      </Group>

      <Group title="저장된 루틴">
        {!items && !error && <ListLoading />}
        {!items && error && (
          <EmptyState compact icon={Repeat} title="루틴을 불러오지 못했어요" description={error} action={<Button onClick={retry}>다시 시도</Button>} />
        )}
        {items?.length === 0 && <EmptyState compact icon={Repeat} title="아직 저장한 루틴이 없어요" />}
        {items && items.length > 0 && (
          <ul className="divide-y divide-separator">
            {items.map((routine) => (
              <li key={routine.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-[180px] flex-1">
                  <p className="text-callout font-medium break-words text-label">{routine.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-subhead break-words text-label-2">{routine.goal}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" icon={Play} loading={runningId === routine.id} onClick={() => void run(routine)}>
                    지금 실행
                  </Button>
                  <IconButton icon={Trash2} label={`${routine.title} 지우기`} onClick={() => void remove(routine.id)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </div>
  );
}
