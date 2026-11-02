import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@/lib/contracts';
import { createNoteSync, NOTE_SAVE_DELAY_MS, type NoteDraft } from '@/components/planner/noteSync';

/** 서버와 저장 공간을 흉내 낸다. put은 기본적으로 성공한다. */
function setup(options: { draft?: NoteDraft | null; note?: Note } = {}) {
  let serverNote: Note = options.note ?? { body: '저장된 원본 메모', updatedAt: 1000 };
  let draft: NoteDraft | null = options.draft ?? null;
  const get = vi.fn(async (): Promise<Note> => serverNote);
  const put = vi.fn(async (body: string): Promise<Note> => {
    serverNote = { body, updatedAt: Date.now() };
    return serverNote;
  });
  const putOnLeave = vi.fn((body: string) => {
    serverNote = { body, updatedAt: Date.now() };
  });
  const sync = createNoteSync({
    get,
    put,
    putOnLeave,
    readDraft: () => draft,
    writeDraft: (body) => {
      draft = { body, at: Date.now() };
    },
    clearDraft: () => {
      draft = null;
    },
    describeError: (_err, fallback) => fallback,
  });
  return {
    sync,
    get,
    put,
    putOnLeave,
    server: () => serverNote,
    draft: () => draft,
    failGetOnce: () => get.mockImplementationOnce(async () => Promise.reject(new Error('서버 오류'))),
  };
}

const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('읽기에 실패한 메모 (저장된 메모를 지우던 버그)', () => {
  it('페이지를 떠나도 빈 내용을 보내지 않는다', async () => {
    const t = setup();
    t.failGetOnce();
    t.sync.load();
    await settle();
    expect(t.sync.getSnapshot().status).toBe('load_error');
    t.sync.flush();
    await settle();
    expect(t.putOnLeave).not.toHaveBeenCalled();
    expect(t.put).not.toHaveBeenCalled();
    expect(t.server().body).toBe('저장된 원본 메모');
  });

  it('입력창을 떠나도 저장하지 않는다', async () => {
    const t = setup();
    t.failGetOnce();
    t.sync.load();
    await settle();
    t.sync.saveNow();
    await vi.advanceTimersByTimeAsync(NOTE_SAVE_DELAY_MS * 2);
    expect(t.put).not.toHaveBeenCalled();
  });

  it('초안이 없으면 입력을 막는다', async () => {
    const t = setup();
    t.failGetOnce();
    t.sync.load();
    await settle();
    expect(t.sync.getSnapshot().editable).toBe(false);
    t.sync.edit('덮어쓸 뻔한 글');
    expect(t.sync.getSnapshot().body).toBe('');
    expect(t.draft()).toBeNull();
    await vi.advanceTimersByTimeAsync(NOTE_SAVE_DELAY_MS * 2);
    expect(t.put).not.toHaveBeenCalled();
  });

  it('다시 시도는 다시 읽기만 하고 저장하지 않는다', async () => {
    const t = setup();
    t.failGetOnce();
    t.sync.load();
    await settle();
    t.failGetOnce();
    t.sync.retry();
    await settle();
    expect(t.get).toHaveBeenCalledTimes(2);
    expect(t.put).not.toHaveBeenCalled();
    expect(t.sync.getSnapshot().status).toBe('load_error');

    t.sync.retry();
    await settle();
    expect(t.sync.getSnapshot()).toMatchObject({ body: '저장된 원본 메모', status: 'saved', editable: true });
    expect(t.put).not.toHaveBeenCalled();
    expect(t.server().body).toBe('저장된 원본 메모');
  });

  it('읽는 중에는 떠나도 보내지 않는다', async () => {
    const t = setup();
    t.get.mockImplementationOnce(() => new Promise(() => undefined));
    t.sync.load();
    t.sync.flush();
    await settle();
    expect(t.putOnLeave).not.toHaveBeenCalled();
  });

  it('retryLoad는 읽기 실패 때만 다시 읽는다', async () => {
    const t = setup();
    t.sync.load();
    await settle();
    expect(t.get).toHaveBeenCalledTimes(1);
    t.sync.retryLoad();
    await settle();
    expect(t.get).toHaveBeenCalledTimes(1);
  });
});

describe('읽기 실패 + 저장 못 한 초안', () => {
  const draft: NoteDraft = { body: '저장 못 한 초안', at: 5000 };

  it('초안을 보여주고 이어서 적게 하지만 서버는 건드리지 않는다', async () => {
    const t = setup({ draft });
    t.failGetOnce();
    t.sync.load();
    await settle();
    expect(t.sync.getSnapshot()).toMatchObject({ body: '저장 못 한 초안', status: 'load_error', editable: true });
    t.sync.edit('저장 못 한 초안 더');
    expect(t.sync.getSnapshot().status).toBe('load_error');
    expect(t.draft()?.body).toBe('저장 못 한 초안 더');
    t.sync.flush();
    t.sync.saveNow();
    await vi.advanceTimersByTimeAsync(NOTE_SAVE_DELAY_MS * 2);
    expect(t.put).not.toHaveBeenCalled();
    expect(t.putOnLeave).not.toHaveBeenCalled();
    expect(t.server().body).toBe('저장된 원본 메모');
  });

  it('읽기에 성공하고 초안이 더 새로우면 그때 저장한다', async () => {
    const t = setup({ draft });
    t.failGetOnce();
    t.sync.load();
    await settle();
    t.sync.retry();
    await settle();
    expect(t.put).toHaveBeenCalledWith('저장 못 한 초안');
    expect(t.sync.getSnapshot()).toMatchObject({ body: '저장 못 한 초안', status: 'saved' });
    expect(t.draft()).toBeNull();
  });

  it('서버 내용이 더 새로우면 서버를 따르고 초안을 버린다', async () => {
    const t = setup({ draft, note: { body: '다른 창에서 저장', updatedAt: 9000 } });
    t.sync.load();
    await settle();
    expect(t.sync.getSnapshot().body).toBe('다른 창에서 저장');
    expect(t.put).not.toHaveBeenCalled();
    expect(t.draft()).toBeNull();
  });
});

describe('정상 저장', () => {
  it('입력은 먼저 초안에 남고 잠시 뒤 저장된다', async () => {
    const t = setup();
    t.sync.load();
    await settle();
    t.sync.edit('새 글');
    expect(t.draft()?.body).toBe('새 글');
    expect(t.put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(NOTE_SAVE_DELAY_MS);
    expect(t.put).toHaveBeenCalledWith('새 글');
    expect(t.sync.getSnapshot().status).toBe('saved');
    expect(t.draft()).toBeNull();
  });

  it('바뀐 것이 없으면 떠날 때 보내지 않는다', async () => {
    const t = setup();
    t.sync.load();
    await settle();
    t.sync.flush();
    expect(t.putOnLeave).not.toHaveBeenCalled();
  });

  it('저장 전에 떠나면 마지막 입력을 보낸다', async () => {
    const t = setup();
    t.sync.load();
    await settle();
    t.sync.edit('떠나기 직전 입력');
    t.sync.flush();
    expect(t.putOnLeave).toHaveBeenCalledWith('떠나기 직전 입력');
  });

  it('저장이 실패해도 글을 지우지 않고, 다시 시도는 다시 저장한다', async () => {
    const t = setup();
    t.sync.load();
    await settle();
    t.put.mockImplementationOnce(async () => Promise.reject(new Error('디스크 오류')));
    t.sync.edit('지키고 싶은 글');
    await vi.advanceTimersByTimeAsync(NOTE_SAVE_DELAY_MS);
    expect(t.sync.getSnapshot()).toMatchObject({ body: '지키고 싶은 글', status: 'save_error' });
    expect(t.draft()?.body).toBe('지키고 싶은 글');
    t.sync.retry();
    await settle();
    expect(t.sync.getSnapshot().status).toBe('saved');
    expect(t.server().body).toBe('지키고 싶은 글');
  });

  it('저장 중에 더 적으면 끝난 뒤 이어서 저장한다', async () => {
    const t = setup();
    t.sync.load();
    await settle();
    t.sync.edit('첫째');
    await vi.advanceTimersByTimeAsync(NOTE_SAVE_DELAY_MS);
    t.sync.edit('첫째 둘째');
    await vi.advanceTimersByTimeAsync(NOTE_SAVE_DELAY_MS * 2);
    expect(t.server().body).toBe('첫째 둘째');
    expect(t.sync.getSnapshot().status).toBe('saved');
  });
});

describe('전체 삭제 (지운 메모가 되살아나던 버그)', () => {
  it('멈춘 동안에는 예약된 저장도, 떠날 때의 저장도 보내지 않는다', async () => {
    const t = setup();
    t.sync.load();
    await settle();
    t.sync.edit('지워져야 할 글');
    t.sync.suspend();
    await vi.advanceTimersByTimeAsync(NOTE_SAVE_DELAY_MS * 3);
    t.sync.flush();
    t.sync.saveNow();
    await settle();
    expect(t.put).not.toHaveBeenCalled();
    expect(t.putOnLeave).not.toHaveBeenCalled();
  });

  it('삭제가 실패해 재개하면 남은 입력을 저장한다', async () => {
    const t = setup();
    t.sync.load();
    await settle();
    t.sync.edit('아직 남은 글');
    t.sync.suspend();
    t.sync.resume();
    await vi.advanceTimersByTimeAsync(NOTE_SAVE_DELAY_MS);
    expect(t.server().body).toBe('아직 남은 글');
  });
});
