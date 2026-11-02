'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { setGestureState, type GesturePhase } from '@/context/GestureContext';
import type { GestureType, Landmark } from '@/lib/client/gesture/classify';
import { GestureEngine, type EngineOutput } from '@/lib/client/gesture/engine';
import { getHands, setResultsHandler } from './tracker';

const BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

/** 영상은 CSS로 좌우 반전되어 있고 좌표도 반전된 값이라 그대로 그리면 손 위에 겹친다. */
function drawSkeleton(canvas: HTMLCanvasElement, landmarks: readonly Landmark[] | null, gesture: GestureType) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!landmarks) return;

  const styles = getComputedStyle(document.documentElement);
  const joint = (gesture === 'pinch' ? styles.getPropertyValue('--success') : styles.getPropertyValue('--accent')).trim() || '#0a84ff';

  context.strokeStyle = 'rgba(255, 255, 255, 0.82)';
  context.lineWidth = 1.5;
  context.lineCap = 'round';
  context.beginPath();
  for (const [a, b] of BONES) {
    context.moveTo(landmarks[a].x * width, landmarks[a].y * height);
    context.lineTo(landmarks[b].x * width, landmarks[b].y * height);
  }
  context.stroke();

  context.fillStyle = joint;
  landmarks.forEach((point, i) => {
    const radius = i === 8 || i === 4 ? 3.5 : 2;
    context.beginPath();
    context.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
    context.fill();
  });
}

function phaseFromCameraError(err: unknown): GesturePhase {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-camera';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'no-camera';
}

interface Options {
  enabled: boolean;
  /** 값이 바뀌면 처음부터 다시 시도한다 */
  attempt: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onFrame: (output: EngineOutput) => void;
}

/**
 * 카메라와 손 인식 수명 주기.
 * 권한은 켜진 뒤에만 요청하고, 끄거나 탭이 숨겨지면 카메라를 완전히 멈춘다.
 */
export function useHandTracking({ enabled, attempt, videoRef, canvasRef, onFrame }: Options) {
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !video) return;

    let disposed = false;
    /** 재시작 때마다 올려서 끝나지 않은 이전 시작을 무시한다 */
    let run = 0;
    let stream: MediaStream | null = null;
    let frame = 0;
    let lastVideoTime = -1;
    let sending = false;
    let failures = 0;
    const engine = new GestureEngine();

    const stopCamera = () => {
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video.srcObject = null;
    };

    const fail = (phase: GesturePhase) => {
      stopCamera();
      setGestureState({ phase, gesture: 'none', handVisible: false });
    };

    setResultsHandler((results) => {
      if (disposed) return;
      const landmarks = results.multiHandLandmarks?.[0] ?? null;
      const output = engine.process({
        timeMs: performance.now(),
        landmarks,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        aspect: video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3,
      });
      const canvas = canvasRef.current;
      if (canvas && canvas.clientWidth > 4) drawSkeleton(canvas, landmarks, output.gesture);
      onFrameRef.current(output);
    });

    const start = async () => {
      const current = ++run;
      if (!navigator.mediaDevices?.getUserMedia) {
        fail('unsupported');
        return;
      }
      setGestureState({ phase: 'requesting', gesture: 'none', handVisible: false });
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        });
      } catch (err) {
        if (!disposed && current === run) fail(phaseFromCameraError(err));
        return;
      }
      if (disposed || current !== run) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = media;
      video.srcObject = media;
      await video.play().catch(() => undefined);

      setGestureState({ phase: 'loading' });
      let hands: Awaited<ReturnType<typeof getHands>>;
      try {
        hands = await getHands();
      } catch (err) {
        console.error('[gesture] 모델을 불러오지 못했습니다', err);
        if (!disposed && current === run) fail('model-failed');
        return;
      }
      if (disposed || current !== run) return;
      setGestureState({ phase: 'ready' });

      failures = 0;
      lastVideoTime = -1;
      const pump = () => {
        if (disposed || current !== run) return;
        if (!sending && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          sending = true;
          hands
            .send({ image: video })
            .then(() => {
              failures = 0;
            })
            .catch((err) => {
              failures += 1;
              if (failures >= 5 && !disposed && current === run) {
                console.error('[gesture] 프레임 처리 실패', err);
                run += 1;
                fail('model-failed');
              }
            })
            .finally(() => {
              sending = false;
            });
        }
        frame = requestAnimationFrame(pump);
      };
      frame = requestAnimationFrame(pump);
    };

    const onVisibility = () => {
      if (document.hidden) {
        run += 1;
        stopCamera();
        engine.reset();
        setGestureState({ phase: 'paused', gesture: 'none', handVisible: false });
      } else {
        void start();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    void start();

    return () => {
      disposed = true;
      run += 1;
      document.removeEventListener('visibilitychange', onVisibility);
      setResultsHandler(() => undefined);
      stopCamera();
      setGestureState({ phase: 'off', gesture: 'none', handVisible: false });
    };
  }, [enabled, attempt, videoRef, canvasRef]);
}
