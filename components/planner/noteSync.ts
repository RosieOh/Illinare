import type { Note } from '@/lib/contracts';

/**
 * 빠른 메모의 저장 규칙 (React 없는 부분).
 *
 * 가장 중요한 규칙: 서버의 메모를 한 번이라도 읽기 전에는 절대 저장하지 않는다.
 * 읽기에 실패한 상태에서 저장하면 빈 값이나 낡은 값이 저장된 메모를 덮어쓴다.
 * 입력은 먼저 이 기기에 초안으로 남기므로, 저장이 실패해도 글은 사라지지 않는다.
 */
export const NOTE_SAVE_DELAY_MS = 700;

/** 전체 삭제 요청 직전에 보내는 신호. 메모가 지워진 내용을 다시 저장하지 못하게 멈춘다. */
export const DATA_WIPE_START = 'illionaire:data-wipe-start';
/** 전체 삭제가 실패했을 때 보내는 신호. 멈춘 저장을 이어 간다. */
export const DATA_WIPE_FAILED = 'illionaire:data-wipe-failed';

export type NoteStatus = 'loading' | 'saved' | 'dirty' | 'saving' | 'save_error' | 'load_error';

export interface NoteSnapshot {
  body: string;
  status: NoteStatus;
  /** 사용자에게 보여줄 문제 설명 */
  error: string | null;
  /** false면 서버 내용을 모르는 상태라 입력을 막는다 */
  editable: boolean;
}

export interface NoteDraft {
  body: string;
  at: number;
}

export interface NoteDeps {
  get: () => Promise<Note>;
  put: (body: string) => Promise<Note>;
  /** 페이지를 떠날 때 보내는 마지막 저장 (응답을 기다리지 않는다) */
  putOnLeave: (body: string) => void;
  readDraft: () => NoteDraft | null;
  writeDraft: (body: string) => void;
  clearDraft: () => void;
  describeError: (err: unknown, fallback: string) => string;
}

export interface NoteSync {
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => NoteSnapshot;
  load: () => void;
  edit: (body: string) => void;
  /** 저장 실패에서는 다시 저장, 읽기 실패에서는 다시 읽기 */
  retry: () => void;
  /** 읽기에 실패한 상태일 때만 다시 읽는다 (창에 돌아왔을 때, 뷰가 보일 때) */
  retryLoad: () => void;
  /** 지금까지의 입력을 바로 저장한다 (입력창을 떠날 때) */
  saveNow: () => void;
  /** 페이지를 떠날 때 */
  flush: () => void;
  suspend: () => void;
  resume: () => void;
  dispose: () => void;
}

export function createNoteSync(deps: NoteDeps): NoteSync {
  const listeners = new Set<() => void>();
  let snapshot: NoteSnapshot = { body: '', status: 'loading', error: null, editable: false };
  /** 서버 내용을 알고 있는가. 이 값이 false인 동안에는 어떤 경로로도 저장하지 않는다. */
  let loaded = false;
  let loading = false;
  let savedBody = '';
  let latest = '';
  let saving = false;
  let suspended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const publish = (patch: Partial<NoteSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((fn) => fn());
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void save(), NOTE_SAVE_DELAY_MS);
  };

  const save = async () => {
    if (!loaded || suspended) return;
    clearTimeout(timer);
    if (saving) return;
    const toSave = latest;
    if (toSave === savedBody) {
      deps.clearDraft();
      publish({ status: 'saved', error: null });
      return;
    }
    saving = true;
    publish({ status: 'saving' });
    try {
      await deps.put(toSave);
      savedBody = toSave;
      if (latest === toSave) {
        deps.clearDraft();
        publish({ status: 'saved', error: null });
      } else {
        publish({ status: 'dirty', error: null });
        schedule();
      }
    } catch (err) {
      publish({ status: 'save_error', error: deps.describeError(err, '메모를 저장하지 못했어요.') });
    } finally {
      saving = false;
    }
  };

  const load = () => {
    if (loaded || loading) return;
    loading = true;
    publish({ status: 'loading', error: null });
    deps
      .get()
      .then((note) => {
        loaded = true;
        savedBody = note.body;
        const draft = deps.readDraft();
        // 저장 못 한 초안이 서버 내용보다 새로우면 초안을 살리고, 아니면 서버 내용을 믿는다.
        const useDraft = draft !== null && draft.body !== note.body && draft.at > note.updatedAt;
        latest = useDraft ? draft.body : note.body;
        if (useDraft) {
          publish({ body: latest, status: 'dirty', error: null, editable: true });
          void save();
        } else {
          deps.clearDraft();
          publish({ body: latest, status: 'saved', error: null, editable: true });
        }
      })
      .catch(() => {
        const draft = deps.readDraft();
        if (draft) {
          // 전에 적던 글은 보여주고 이어서 적게 하되, 서버를 읽기 전에는 보내지 않는다.
          latest = draft.body;
          publish({
            body: draft.body,
            status: 'load_error',
            editable: true,
            error: '저장된 메모를 읽지 못했어요. 적은 글은 이 기기에 남아 있고, 연결되면 저장돼요.',
          });
        } else {
          // 서버 내용을 모르니 입력도 막는다. 여기서 적은 글이 저장된 메모를 덮어쓰면 안 된다.
          publish({
            body: '',
            status: 'load_error',
            editable: false,
            error: '저장된 메모를 읽지 못했어요. 메모는 그대로 있어요.',
          });
        }
      })
      .finally(() => {
        loading = false;
      });
  };

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getSnapshot: () => snapshot,
    load,
    edit(body) {
      if (!snapshot.editable) return;
      latest = body;
      deps.writeDraft(body);
      if (loaded) {
        publish({ body, status: 'dirty', error: null });
        schedule();
      } else {
        publish({ body });
      }
    },
    retry() {
      if (loaded) void save();
      else load();
    },
    retryLoad() {
      if (!loaded) load();
    },
    saveNow() {
      void save();
    },
    flush() {
      if (!loaded || suspended || latest === savedBody) return;
      deps.putOnLeave(latest);
    },
    suspend() {
      suspended = true;
      clearTimeout(timer);
    },
    resume() {
      suspended = false;
      if (loaded && latest !== savedBody) schedule();
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
