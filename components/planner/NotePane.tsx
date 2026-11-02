'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Note } from '@/lib/contracts';
import { api, ClientApiError } from '@/lib/client/api';
import { Button, Material, Skeleton } from '@/components/glass';
import { createNoteSync, DATA_WIPE_FAILED, DATA_WIPE_START, type NoteDraft, type NoteStatus, type NoteSync } from './noteSync';

const DRAFT_KEY = 'illionaire_note_draft';

function readDraft(): NoteDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as NoteDraft) : null;
  } catch {
    return null;
  }
}

function writeDraft(body: string) {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ body, at: Date.now() } satisfies NoteDraft));
  } catch {
    /* 저장 공간이 막혀도 서버 저장은 시도한다 */
  }
}

function clearDraft() {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* 지우지 못해도 다음에 내용이 같으면 무시된다 */
  }
}

function createSync(): NoteSync {
  return createNoteSync({
    get: () => api.get<Note>('/api/note'),
    put: (body) => api.put<Note>('/api/note', { body }),
    putOnLeave: (body) => {
      void fetch('/api/note', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
        keepalive: body.length < 60_000,
      }).catch(() => undefined);
    },
    readDraft,
    writeDraft,
    clearDraft,
    describeError: (err, fallback) => (err instanceof ClientApiError ? err.message : fallback),
  });
}

const STATUS_LABEL: Record<NoteStatus, string> = {
  loading: '불러오는 중',
  saved: '저장됨',
  dirty: '입력 중',
  saving: '저장 중',
  save_error: '저장 안 됨',
  load_error: '불러오지 못함',
};

/** 빠른 메모. 저장 규칙은 noteSync.ts에 있다. */
export function NotePane({ active }: { active: boolean }) {
  const [sync] = useState(createSync);
  const note = useSyncExternalStore(sync.subscribe, sync.getSnapshot, sync.getSnapshot);

  useEffect(() => {
    sync.load();
    const onLeave = () => sync.flush();
    const onReturn = () => sync.retryLoad();
    const onWipeStart = () => sync.suspend();
    const onWipeFailed = () => sync.resume();
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('focus', onReturn);
    window.addEventListener('online', onReturn);
    window.addEventListener(DATA_WIPE_START, onWipeStart);
    window.addEventListener(DATA_WIPE_FAILED, onWipeFailed);
    return () => {
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('online', onReturn);
      window.removeEventListener(DATA_WIPE_START, onWipeStart);
      window.removeEventListener(DATA_WIPE_FAILED, onWipeFailed);
      sync.dispose();
    };
  }, [sync]);

  // 숨겨진 채로 마운트돼 있다가 실패했을 수 있으니 화면에 들어올 때 다시 읽는다.
  useEffect(() => {
    if (active) sync.retryLoad();
  }, [active, sync]);

  const failed = note.status === 'save_error' || note.status === 'load_error';

  return (
    <Material as="section" aria-label="빠른 메모" className="flex min-h-[220px] flex-1 flex-col p-3.5">
      <header className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 className="text-title3 text-label">빠른 메모</h2>
        <span role="status" className={`text-footnote ${failed ? 'font-medium text-danger-text' : 'text-label-2'}`}>
          {STATUS_LABEL[note.status]}
        </span>
      </header>

      {note.status === 'loading' && !note.body ? (
        <div className="flex-1 space-y-2.5 px-3 py-2.5" aria-hidden="true">
          <Skeleton width="80%" className="block" />
          <Skeleton width="55%" className="block" />
        </div>
      ) : (
        <div className="field flex min-h-0 flex-1 px-3 py-2.5">
          <textarea
            value={note.body}
            onChange={(e) => sync.edit(e.target.value)}
            onBlur={() => sync.saveNow()}
            readOnly={!note.editable}
            maxLength={200_000}
            aria-label="메모 내용"
            placeholder={note.editable ? '회의 중 떠오른 생각, 나중에 맡길 일…' : '메모를 불러온 뒤에 적을 수 있어요'}
            className="block size-full min-h-[120px] resize-none bg-transparent text-callout text-label outline-none"
          />
        </div>
      )}

      <div className="mt-2 flex min-h-8 items-center justify-between gap-2 px-1">
        {failed ? (
          <>
            <p role="alert" className="min-w-0 text-footnote text-danger-text">
              {note.error}
              {note.status === 'save_error' && ' 적은 글은 이 기기에 남아 있어요.'}
            </p>
            <Button size="sm" icon={RotateCcw} onClick={() => sync.retry()}>
              다시 시도
            </Button>
          </>
        ) : (
          <span className="text-footnote text-label-2 tabular-nums">{note.body.length.toLocaleString('ko-KR')}자</span>
        )}
      </div>
    </Material>
  );
}
