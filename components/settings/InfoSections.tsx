'use client';

import { useEffect, useState } from 'react';
import { Copy, Download, Trash2 } from 'lucide-react';
import { BRAND } from '@/lib/contracts';
import { Badge, Button, IconButton, Kbd, Sheet, TextField, Toggle, useToast } from '@/components/glass';
import { DATA_WIPE_FAILED, DATA_WIPE_START } from '@/components/planner/noteSync';
import { useApp } from '@/context/AppContext';
import { api, ClientApiError } from '@/lib/client/api';
import { downloadJson } from './download';
import { Group, useSave } from './shared';

// ─── 음성·제스처 ─────────────────────────────────────────────
export function VoiceSection() {
  const { settings, gestureEnabled, setGestureEnabled, bootstrap } = useApp();
  const save = useSave();
  return (
    <div className="space-y-5">
      <Group title="음성">
        <Toggle
          label="답변 읽어 주기"
          description="미션이 끝나면 답변 앞부분을 소리 내어 읽어요. 운영체제에 설치된 음성을 써요."
          checked={settings.speakAnswers}
          onChange={(speakAnswers) => void save({ speakAnswers })}
        />
        <p className="mt-3 text-subhead text-label-2">
          {bootstrap?.desktop
            ? '데스크톱 앱에서는 음성 입력에 운영체제의 받아쓰기를 써요. Windows는 Win+H, macOS는 받아쓰기 단축키로 시작할 수 있어요.'
            : '브라우저의 음성 인식은 브라우저 제공사의 서비스로 음성을 보낼 수 있어요. 데스크톱 앱에서는 운영체제의 받아쓰기를 대신 써요.'}
        </p>
      </Group>

      <Group title="제스처">
        <Toggle
          label="손동작으로 조작"
          description="카메라로 손 모양을 읽어 커서를 움직이고 발표를 넘겨요. 영상 처리는 이 기기 안에서만 이루어져요."
          checked={gestureEnabled}
          onChange={setGestureEnabled}
        />
        <p className="mt-3 text-subhead text-label-2">승인과 거부는 제스처로 할 수 없어요. 앱을 다시 열면 이 설정은 꺼져요.</p>
      </Group>
    </div>
  );
}

// ─── 데이터 ──────────────────────────────────────────────────
const CONFIRM_WORD = '삭제';
const LOCAL_KEY_PREFIX = 'illionaire_';

/** 이 기기에 남은 앱 데이터를 지운다. 메모 초안이나 구버전 데이터가 남으면 다음 실행 때 지운 내용이 되살아난다. */
function clearLocalData() {
  for (const getStore of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const store = getStore();
      for (const key of Object.keys(store)) {
        if (key.startsWith(LOCAL_KEY_PREFIX)) store.removeItem(key);
      }
    } catch {
      /* 저장 공간을 쓸 수 없으면 지울 것도 없다 */
    }
  }
}

export function DataSection() {
  const { bootstrap, view } = useApp();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const dir = bootstrap?.dataDir ?? '';

  const copyDir = async () => {
    try {
      await navigator.clipboard.writeText(dir);
      toast({ title: '경로를 복사했어요' });
    } catch {
      toast({ tone: 'danger', title: '복사하지 못했어요', description: '경로를 직접 선택해 복사해 주세요.' });
    }
  };

  const exportAll = async () => {
    setExporting(true);
    try {
      downloadJson('illionaire-export', await api.get('/api/data/export'));
    } catch (err) {
      toast({ tone: 'danger', title: '내보내지 못했어요', description: err instanceof ClientApiError ? err.message : undefined });
    } finally {
      setExporting(false);
    }
  };

  const closeConfirm = () => {
    setConfirmOpen(false);
    setTyped('');
    setDeleteError(null);
  };

  const deleteAll = async () => {
    setDeleting(true);
    setDeleteError(null);
    // 삭제와 겹쳐 메모가 저장되면 지운 내용이 되살아나므로 먼저 멈춘다.
    window.dispatchEvent(new Event(DATA_WIPE_START));
    try {
      await api.del('/api/data');
    } catch (err) {
      window.dispatchEvent(new Event(DATA_WIPE_FAILED));
      setDeleteError(err instanceof ClientApiError ? err.message : '지우지 못했어요.');
      setDeleting(false);
      return;
    }
    // 화면에 남은 상태가 지운 데이터를 다시 저장하지 못하도록 처음부터 다시 연다. 온보딩이 이어진다.
    clearLocalData();
    window.location.reload();
  };

  // 시트는 뷰 바깥에 그려지므로 다른 화면으로 가면 닫아야 한다.
  const sheetVisible = confirmOpen && view === 'settings';
  useEffect(() => {
    if (confirmOpen && view !== 'settings' && !deleting) {
      setConfirmOpen(false);
      setTyped('');
      setDeleteError(null);
    }
  }, [confirmOpen, view, deleting]);

  return (
    <div className="space-y-5">
      <Group title="저장 위치" description="설정, 할 일, 미션 기록, 활동 기록을 이 폴더에 저장해요. 다른 곳으로 동기화하지 않아요.">
        <div className="flex items-center gap-2 rounded-[12px] bg-fill-4 py-1.5 pr-1.5 pl-3">
          <code className="min-w-0 flex-1 font-mono text-footnote break-all text-label">{dir || '알 수 없음'}</code>
          <IconButton icon={Copy} label="경로 복사" disabled={!dir} onClick={() => void copyDir()} />
        </div>
      </Group>

      <Group title="기기 밖으로 나가는 데이터">
        <ul className="list-disc space-y-1.5 pl-5 text-subhead text-label-2 marker:text-label-3">
          <li>
            미션을 실행하면 요청 내용, 기억, 에이전트가 읽은 파일 내용과 도구 결과가 Anthropic API로 전송돼요. 데모 모드에서는 전송하지 않아요.
          </li>
          <li>그 밖에는 날씨 조회에 쓰는 도시 이름이 wttr.in으로 가고, 리서처의 웹 검색과 페이지 읽기는 Anthropic을 거쳐 웹으로 나가요.</li>
          <li>승인한 웹 주소는 기본 브라우저로 열려요. 브라우저에서 음성 입력을 쓰면 브라우저 제공사의 서비스로 음성이 갈 수 있어요.</li>
        </ul>
      </Group>

      <Group title="내보내기" description="API 키를 뺀 모든 데이터를 JSON 파일 하나로 받아요.">
        <Button icon={Download} loading={exporting} onClick={() => void exportAll()}>
          데이터 내보내기
        </Button>
      </Group>

      <Group title="모두 지우기">
        <ul className="list-disc space-y-1 pl-5 text-subhead text-label-2 marker:text-label-3">
          <li>설정, 할 일, 일정, 메모, 기억, 루틴, 발표 자료, 미션 기록, 활동 기록, 되돌리기 정보를 지워요.</li>
          <li>API 키는 남아요. AI 항목에서 따로 지울 수 있어요.</li>
          <li>바탕 화면에 저장한 노트와 스크린샷처럼 폴더 밖에 만든 파일은 지우지 않아요.</li>
        </ul>
        <Button variant="danger" icon={Trash2} className="mt-3" onClick={() => setConfirmOpen(true)}>
          모든 데이터 지우기
        </Button>
      </Group>

      <Sheet
        open={sheetVisible}
        onClose={closeConfirm}
        title="모든 데이터를 지울까요?"
        description="지운 데이터는 되돌릴 수 없어요. 진행 중인 미션도 함께 멈춰요."
        width={460}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={closeConfirm}>취소</Button>
            <Button variant="danger" loading={deleting} disabled={typed.trim() !== CONFIRM_WORD} onClick={() => void deleteAll()}>
              모두 지우기
            </Button>
          </div>
        }
      >
        <TextField
          label={`확인을 위해 "${CONFIRM_WORD}"를 입력해 주세요`}
          autoFocus
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          error={deleteError}
        />
      </Sheet>
    </div>
  );
}

// ─── 정보 ─────────────────────────────────────────────────────
const PLATFORM_LABEL = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' } as const;

export function AboutSection() {
  const { bootstrap } = useApp();
  const mod = bootstrap?.platform === 'darwin' ? '⌘' : 'Ctrl';
  const shortcuts: Array<{ keys: string[]; label: string }> = [
    { keys: [mod, 'K'], label: '명령 찾기' },
    { keys: ['/'], label: '입력창으로 이동' },
    { keys: [mod, '1~7'], label: '화면 전환' },
    { keys: ['Enter'], label: '입력창에서 보내기' },
    { keys: ['Shift', 'Enter'], label: '입력창에서 줄 바꾸기' },
    { keys: ['Esc'], label: '시트와 명령 찾기 닫기' },
  ];

  return (
    <div className="space-y-5">
      <Group>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-callout">
          <dt className="text-label-2">앱</dt>
          <dd className="text-label">
            {BRAND.name} ({BRAND.nameEn})
          </dd>
          <dt className="text-label-2">버전</dt>
          <dd className="text-label tabular-nums">{BRAND.version}</dd>
          <dt className="text-label-2">운영체제</dt>
          <dd className="text-label">{bootstrap ? PLATFORM_LABEL[bootstrap.platform] : '확인 중'}</dd>
          <dt className="text-label-2">실행 형태</dt>
          <dd className="text-label">{bootstrap?.desktop ? '데스크톱 앱' : '브라우저'}</dd>
          <dt className="text-label-2">라이선스</dt>
          <dd className="flex flex-wrap items-center gap-2 text-label">
            <Badge tone="warning">미정</Badge>
            <span className="text-label-2">출시 전에 소유자가 채울 항목이에요.</span>
          </dd>
        </dl>
      </Group>

      <Group title="키보드 단축키">
        <ul className="divide-y divide-separator">
          {shortcuts.map(({ keys, label }) => (
            <li key={label} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <span className="text-callout text-label">{label}</span>
              <span className="flex items-center gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Group>
    </div>
  );
}
