'use client';

import './gesture.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeftRight,
  CameraOff,
  ChevronUp,
  CircleHelp,
  Hand,
  HandFist,
  Loader2,
  Minus,
  MousePointerClick,
  Pointer,
  Presentation,
  RefreshCw,
  ShieldCheck,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button, IconButton, LiquidGlass, useToast } from '@/components/glass';
import { useRegisterCommands, type Command } from '@/components/shell/commands';
import { requestPresentation } from '@/components/decks/intent';
import { useApp } from '@/context/AppContext';
import { emitSwipe, publishCursor, setGestureState, useGestureState, type GesturePhase } from '@/context/GestureContext';
import type { GestureType } from '@/lib/client/gesture/classify';
import type { EngineOutput } from '@/lib/client/gesture/engine';
import { closeTopDialog, findActionTarget, hasOpenDialog, isApprovalElement, pressElement, type ActionTarget } from './dom';
import GestureCursor from './GestureCursor';
import { useHandTracking } from './useHandTracking';

const GUIDE_KEY = 'illionaire_gesture_guide_seen';

const GESTURE_LABEL: Record<GestureType, string> = {
  none: '인식 중',
  point: '커서 이동',
  pinch: '누르기',
  open: '손바닥',
  fist: '주먹',
  peace: '브이',
};

const PHASE_MESSAGE: Partial<Record<GesturePhase, string>> = {
  requesting: '카메라 권한을 기다리고 있어요.',
  loading: '손 인식 모델을 불러오고 있어요.',
  paused: '다른 창을 보는 동안 카메라를 꺼 두었어요. 돌아오면 다시 켜져요.',
  denied: '카메라 권한이 막혀 있어요. 브라우저나 시스템 설정에서 허용한 뒤 다시 시도해 주세요.',
  'no-camera': '연결된 카메라를 찾지 못했어요. 카메라를 연결한 뒤 다시 시도해 주세요.',
  busy: '다른 앱이 카메라를 쓰고 있어요. 그 앱을 닫은 뒤 다시 시도해 주세요.',
  'model-failed': '손 인식 모델을 불러오지 못했어요. 앱을 다시 시작한 뒤 시도해 주세요.',
  unsupported: '이 환경에서는 카메라를 쓸 수 없어요.',
};

const FAILED_PHASES: readonly GesturePhase[] = ['denied', 'no-camera', 'busy', 'model-failed', 'unsupported'];

const GUIDE: ReadonlyArray<{ icon: LucideIcon; text: string }> = [
  { icon: Pointer, text: '검지를 움직이면 커서가 따라와요' },
  { icon: MousePointerClick, text: '엄지와 검지를 모으면 눌러요' },
  { icon: ArrowLeftRight, text: '손바닥을 좌우로 쓸면 발표 슬라이드가 넘어가요' },
  { icon: Hand, text: '손바닥을 1초 펴고 있으면 입력창으로 가요' },
  { icon: HandFist, text: '주먹을 1초 쥐고 있으면 열린 시트가 닫혀요' },
  { icon: ShieldCheck, text: '승인은 제스처로 할 수 없어요. 직접 눌러 주세요' },
];

const HOLD_LABEL = { open: '입력창으로 가요', fist: '시트를 닫아요' } as const;

/** 가까운 버튼 쪽으로 레티클이 끌려가는 정도 */
const SNAP_PULL = 0.45;
const SNAP_INTERVAL_MS = 90;

function readGuideSeen(): boolean {
  try {
    return localStorage.getItem(GUIDE_KEY) === '1';
  } catch {
    return true;
  }
}

function writeGuideSeen() {
  try {
    localStorage.setItem(GUIDE_KEY, '1');
  } catch {
    /* 저장하지 못해도 다음에 안내가 한 번 더 뜰 뿐이다 */
  }
}

function setHover(previous: HTMLElement | null, next: HTMLElement | null): HTMLElement | null {
  if (previous === next) return previous;
  previous?.removeAttribute('data-gesture-hover');
  next?.setAttribute('data-gesture-hover', '');
  return next;
}

/** 켜져 있는 동안에만 마운트된다. 꺼지면 카메라가 함께 멈춘다. */
function GestureSession() {
  const { setGestureEnabled, chromeHidden, focusComposer } = useApp();
  const { phase, gesture, handVisible } = useGestureState();
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<HTMLElement | null>(null);
  const snapRef = useRef<{ at: number; target: ActionTarget | null }>({ at: 0, target: null });
  const [attempt, setAttempt] = useState(0);
  // 좁은 화면에서는 패널이 콘텐츠를 가리지 않도록 접은 채로 시작한다. 추적은 그대로 돈다.
  const [minimized, setMinimized] = useState(() => window.innerWidth <= 820);
  const [guideOpen, setGuideOpen] = useState(() => !readGuideSeen());

  const onFrame = useCallback(
    (output: EngineOutput) => {
      setGestureState({ gesture: output.gesture, handVisible: output.handVisible });

      let shownX = output.cursor?.x ?? 0;
      let shownY = output.cursor?.y ?? 0;
      let snapped = false;
      if (output.cursor) {
        const now = performance.now();
        if (now - snapRef.current.at > SNAP_INTERVAL_MS) {
          snapRef.current = { at: now, target: findActionTarget(output.cursor.x, output.cursor.y) };
        }
        const target = snapRef.current.target;
        if (target && target.el.isConnected) {
          const rect = target.el.getBoundingClientRect();
          const inside = output.cursor.x >= rect.left && output.cursor.x <= rect.right && output.cursor.y >= rect.top && output.cursor.y <= rect.bottom;
          snapped = true;
          if (!inside) {
            shownX += (target.x - shownX) * SNAP_PULL;
            shownY += (target.y - shownY) * SNAP_PULL;
          }
          hoverRef.current = setHover(hoverRef.current, isApprovalElement(target.el) ? null : target.el);
        } else {
          hoverRef.current = setHover(hoverRef.current, null);
        }
      } else {
        hoverRef.current = setHover(hoverRef.current, null);
      }

      const holdApplies = output.holdKind === 'open' ? !chromeHidden && !hasOpenDialog() : output.holdKind === 'fist' ? hasOpenDialog() : false;

      publishCursor({
        visible: output.cursor !== null,
        x: shownX,
        y: shownY,
        pinching: output.pinching,
        snapped,
        hold: holdApplies ? output.holdProgress : 0,
        holdLabel: output.holdKind && holdApplies ? HOLD_LABEL[output.holdKind] : '',
      });

      if (output.click) {
        const target = findActionTarget(output.click.x, output.click.y);
        if (target) {
          // 제스처는 어떤 경우에도 승인으로 이어지면 안 된다.
          if (isApprovalElement(target.el)) {
            toast({ tone: 'warning', title: '승인은 직접 눌러 주세요', duration: 3000 });
          } else {
            pressElement(target);
          }
        }
      }

      if (output.swipe) emitSwipe(output.swipe);

      if (holdApplies && output.holdFired === 'open') focusComposer();
      if (holdApplies && output.holdFired === 'fist') closeTopDialog();
    },
    [chromeHidden, focusComposer, toast]
  );

  useHandTracking({ enabled: true, attempt, videoRef, canvasRef, onFrame });

  useEffect(() => {
    return () => {
      hoverRef.current?.removeAttribute('data-gesture-hover');
      hoverRef.current = null;
      publishCursor({ visible: false, hold: 0, holdLabel: '', pinching: false, snapped: false });
    };
  }, []);

  const failed = FAILED_PHASES.includes(phase);
  const message = PHASE_MESSAGE[phase];
  const statusLabel =
    phase === 'ready' ? (handVisible ? GESTURE_LABEL[gesture] : '손을 보여 주세요') : failed ? '제스처를 쓸 수 없어요' : '준비 중';

  const dismissGuide = () => {
    writeGuideSeen();
    setGuideOpen(false);
  };

  const guideVisible = guideOpen && !minimized && !failed;

  return createPortal(
    <>
      <GestureCursor />
      <LiquidGlass
        radius={24}
        tint="thick"
        className="gesture-panel p-2"
        data-guide={guideVisible ? '' : undefined}
        data-chrome-hidden={chromeHidden ? '' : undefined}
        data-gesture-ignore=""
        role="group"
        aria-label="제스처 제어"
      >
        <div className="gesture-preview" data-minimized={minimized ? '' : undefined}>
          <video ref={videoRef} playsInline muted aria-hidden="true" />
          <canvas ref={canvasRef} aria-hidden="true" />
          {message && (
            <div className="gesture-preview-message" role={failed ? 'alert' : 'status'}>
              {failed ? (
                <CameraOff size={20} aria-hidden="true" />
              ) : phase !== 'paused' ? (
                <Loader2 size={20} className="animate-spin" aria-hidden="true" />
              ) : null}
              <span>{message}</span>
            </div>
          )}
        </div>

        <div className={`flex items-center gap-1 pl-2 ${minimized ? '' : 'pt-1.5'}`}>
          <Hand size={15} className="shrink-0 text-label-2" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-footnote font-medium text-label">{statusLabel}</span>
          {failed && (
            <IconButton
              icon={RefreshCw}
              label="다시 시도"
              size="sm"
              onClick={() => setAttempt((n) => n + 1)}
            />
          )}
          {!failed && (
            <IconButton
              icon={CircleHelp}
              label="제스처 안내"
              size="sm"
              onClick={() => {
                setMinimized(false);
                setGuideOpen((open) => !open);
              }}
            />
          )}
          <IconButton
            icon={minimized ? ChevronUp : Minus}
            label={minimized ? '패널 펼치기' : '패널 접기'}
            size="sm"
            onClick={() => setMinimized((value) => !value)}
          />
          <IconButton icon={X} label="제스처 끄기" size="sm" onClick={() => setGestureEnabled(false)} />
        </div>

        {guideVisible && (
          <div className="px-2 pb-1.5 pt-2">
            <ul className="space-y-2">
              {GUIDE.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-2.5 text-footnote text-label">
                  <Icon size={15} className="mt-0.5 shrink-0 text-label-2" aria-hidden="true" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-footnote text-label-2">영상은 이 기기에서만 처리하고 밖으로 보내지 않아요.</p>
            <Button size="sm" variant="secondary" fullWidth className="mt-2.5 !rounded-full" onClick={dismissGuide}>
              알겠어요
            </Button>
          </div>
        )}
      </LiquidGlass>
    </>,
    document.body
  );
}

export default function GestureLayer() {
  const { gestureEnabled, navigate } = useApp();

  // 발표 뷰를 한 번도 열지 않았어도 팔레트에서 찾을 수 있도록 여기서 등록한다.
  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'deck-present',
        group: '동작',
        title: '발표 시작',
        subtitle: '가장 최근 발표 자료를 전체 화면으로 열어요',
        icon: Presentation,
        keywords: ['발표', '슬라이드', '프레젠테이션', 'present'],
        run: () => {
          requestPresentation();
          navigate('decks');
        },
      },
    ],
    [navigate]
  );
  useRegisterCommands(commands);

  return gestureEnabled ? <GestureSession /> : null;
}
