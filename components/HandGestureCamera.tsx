'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera, CameraOff, Loader,
  Hand, MousePointer, Pointer, Move,
} from 'lucide-react';
import { useGesture, GestureType } from '@/context/GestureContext';

const GESTURE_LABELS: Record<GestureType, string> = {
  none: '감지 없음',
  point: '포인터 모드',
  pinch: '클릭 (핀치)',
  open: '열린 손',
  fist: '주먹',
  peace: '슬라이드 제어',
};

function detectGesture(kp: Array<{ x: number; y: number; z: number }>): GestureType {
  if (!kp || kp.length < 21) return 'none';

  const up = (tip: number, pip: number) => kp[tip].y < kp[pip].y;
  const idx = up(8, 6);
  const mid = up(12, 10);
  const ring = up(16, 14);
  const pinky = up(20, 18);

  const pinchDist = Math.hypot(kp[4].x - kp[8].x, kp[4].y - kp[8].y);
  if (pinchDist < 0.07) return 'pinch';

  if (idx && mid && ring && pinky) return 'open';
  if (idx && mid && !ring && !pinky) return 'peace';
  if (idx && !mid && !ring && !pinky) return 'point';
  if (!idx && !mid && !ring && !pinky) return 'fist';
  return 'none';
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  kp: Array<{ x: number; y: number }>,
  w: number,
  h: number,
  gesture: GestureType
) {
  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17],
  ];
  const color =
    gesture === 'pinch'
      ? 'rgba(52,211,153,0.9)'
      : gesture === 'peace'
      ? 'rgba(251,191,36,0.9)'
      : 'rgba(56,189,248,0.85)';

  ctx.shadowColor = color;
  ctx.shadowBlur = 4;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;

  connections.forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(kp[a].x * w, kp[a].y * h);
    ctx.lineTo(kp[b].x * w, kp[b].y * h);
    ctx.stroke();
  });

  kp.forEach((p, i) => {
    const isKey = [4, 8, 12, 16, 20].includes(i);
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, isKey ? 5 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = i === 8 ? '#34d399' : color;
    ctx.shadowBlur = isKey ? 8 : 3;
    ctx.fill();
  });
}

function loadMediaPipeScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).Hands || document.getElementById('mp-hands-script')) {
      const poll = setInterval(() => {
        if ((window as any).Hands) {
          clearInterval(poll);
          resolve();
        }
      }, 100);
      return;
    }
    const script = document.createElement('script');
    script.id = 'mp-hands-script';
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js';
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      setTimeout(() => {
        if ((window as any).Hands) resolve();
        else reject(new Error('Hands global not found after script load'));
      }, 200);
    };
    script.onerror = () => reject(new Error('Failed to load MediaPipe script'));
    document.head.appendChild(script);
  });
}

const GUIDE_ITEMS: Array<{ icon: typeof Hand; label: string }> = [
  { icon: Pointer, label: '포인터 커서' },
  { icon: MousePointer, label: '클릭 (핀치)' },
  { icon: Move, label: '슬라이드 이동' },
  { icon: Hand, label: '대기/취소' },
];

export default function HandGestureCamera() {
  const {
    isCameraActive, toggleCamera,
    setGesture, setCursorPos, setModelLoaded,
    gesture, emitSwipe,
  } = useGesture();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handsRef = useRef<any>(null);
  const rafRef = useRef<number>(0);
  const wristHistRef = useRef<number[]>([]);
  const lastSwipeTimeRef = useRef(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    if (!isCameraActive || handsRef.current) return;
    let cancelled = false;
    setStatus('loading');

    const init = async () => {
      try {
        await loadMediaPipeScript();
        if (cancelled) return;

        const HandsClass = (window as any).Hands;
        if (!HandsClass) throw new Error('MediaPipe Hands not available');

        const hands = new HandsClass({
          locateFile: (file: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`,
        });

        hands.setOptions({
          selfieMode: true,
          maxNumHands: 1,
          modelComplexity: 0,
          minDetectionConfidence: 0.55,
          minTrackingConfidence: 0.5,
        });

        hands.onResults((results: any) => {
          if (cancelled) return;
          const canvas = canvasRef.current;
          const video = videoRef.current;
          if (!canvas || !video) return;

          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          canvas.width = canvas.offsetWidth;
          canvas.height = canvas.offsetHeight;
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (results.multiHandLandmarks?.length > 0) {
            const kp = results.multiHandLandmarks[0];
            drawSkeleton(ctx, kp, canvas.width, canvas.height, gesture);

            const g = detectGesture(kp);
            setGesture(g);

            setCursorPos({
              x: kp[8].x * window.innerWidth,
              y: kp[8].y * window.innerHeight,
            });

            const wx = kp[0].x;
            wristHistRef.current.push(wx);
            if (wristHistRef.current.length > 18) wristHistRef.current.shift();

            if (
              wristHistRef.current.length >= 18 &&
              (g === 'peace' || g === 'open')
            ) {
              const now = Date.now();
              if (now - lastSwipeTimeRef.current > 900) {
                const delta = wristHistRef.current[17] - wristHistRef.current[0];
                if (Math.abs(delta) > 0.2) {
                  lastSwipeTimeRef.current = now;
                  wristHistRef.current = [];
                  emitSwipe(delta > 0 ? 'right' : 'left');
                }
              }
            }
          } else {
            setGesture('none');
            setCursorPos(null);
            wristHistRef.current = [];
          }
        });

        await hands.initialize();
        if (cancelled) return;

        handsRef.current = hands;
        setModelLoaded(true);
        setStatus('ready');
      } catch (err) {
        console.error('MediaPipe init error:', err);
        if (!cancelled) setStatus('error');
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [isCameraActive]);

  useEffect(() => {
    if (!isCameraActive) {
      cancelAnimationFrame(rafRef.current);
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
      setGesture('none');
      setCursorPos(null);
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } })
      .then((stream) => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      })
      .catch(() => setStatus('error'));

    return () => {
      cancelAnimationFrame(rafRef.current);
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
    };
  }, [isCameraActive]);

  useEffect(() => {
    if (!isCameraActive || status !== 'ready') return;

    const loop = async () => {
      const video = videoRef.current;
      const hands = handsRef.current;
      if (video && hands && video.readyState >= 2) {
        try {
          await hands.send({ image: video });
        } catch {
          // ignore frame errors
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    loop();
    return () => cancelAnimationFrame(rafRef.current);
  }, [isCameraActive, status]);

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      <AnimatePresence>
        {isCameraActive && !isMinimized && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 8 }}
            className="relative rounded-md overflow-hidden border border-[color:var(--color-accent-ring)] bg-[var(--color-surface-base)]"
            style={{ width: 200, height: 150 }}
          >
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
            />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

            <div className="absolute bottom-0 left-0 right-0 bg-[var(--color-surface-base)]/85 backdrop-blur-sm px-2 py-1 flex items-center gap-2">
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  gesture !== 'none' ? 'bg-[var(--color-success)] status-pulse' : 'bg-[var(--color-text-disabled)]'
                }`}
                aria-hidden="true"
              />
              <span className="text-xs text-secondary font-mono truncate">
                {status === 'loading' ? '모델 로딩 중...' : GESTURE_LABELS[gesture]}
              </span>
            </div>

            {status === 'loading' && (
              <div
                className="absolute inset-0 flex items-center justify-center bg-[var(--color-surface-base)]/70"
                role="status"
                aria-label="AI 모델 로딩 중"
              >
                <div className="flex flex-col items-center gap-2">
                  <Loader size={20} className="text-accent animate-spin" aria-hidden="true" />
                  <span className="text-xs text-accent font-mono">AI 로딩...</span>
                </div>
              </div>
            )}

            {status === 'error' && (
              <div
                className="absolute inset-0 flex items-center justify-center bg-[var(--color-surface-base)]/85 text-center px-3"
                role="alert"
              >
                <span className="text-xs text-[var(--color-danger)]">
                  카메라 접근 실패
                  <br />
                  권한을 확인하세요
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCameraActive && !isMinimized && status === 'ready' && (
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            className="surface rounded-md p-2.5 text-xs space-y-1.5"
          >
            {GUIDE_ITEMS.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2 text-muted">
                <Icon size={12} className="text-secondary" aria-hidden="true" />
                <span>{label}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex gap-2">
        {isCameraActive && (
          <button
            onClick={() => setIsMinimized((v) => !v)}
            aria-label={isMinimized ? '카메라 패널 펼치기' : '카메라 패널 접기'}
            className="px-3 h-8 rounded-md border border-[var(--color-border)] text-xs text-muted hover:text-primary transition-colors"
          >
            {isMinimized ? '펼치기' : '접기'}
          </button>
        )}
        <button
          onClick={toggleCamera}
          aria-pressed={isCameraActive}
          aria-label={isCameraActive ? '제스처 인식 끄기' : '제스처 인식 켜기'}
          className={`flex items-center gap-2 px-3 h-8 rounded-md border text-xs transition-colors ${
            isCameraActive
              ? 'border-[color:var(--color-accent-ring)] bg-[var(--color-accent-soft)] text-primary'
              : 'border-[var(--color-border)] bg-[var(--color-surface-1)] text-muted hover:text-primary'
          }`}
        >
          {isCameraActive ? (
            <Camera size={13} aria-hidden="true" />
          ) : (
            <CameraOff size={13} aria-hidden="true" />
          )}
          {isCameraActive ? '제스처 ON' : '제스처 OFF'}
        </button>
      </div>
    </div>
  );
}
