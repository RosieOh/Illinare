import type { Landmark } from '@/lib/client/gesture/classify';

/**
 * MediaPipe Hands 로더. 스크립트와 모델은 전부 이 앱이 직접 제공한다 (scripts/copy-vendor.mjs).
 * 인스턴스는 페이지당 하나만 만든다. 닫고 다시 만들면 내부 WASM 모듈이 재초기화되지 않아 실패할 수 있으므로,
 * 끌 때는 카메라만 멈추고 모델은 메모리에 둔다.
 */
const BASE = '/vendor/mediapipe/hands';

export interface HandsResults {
  multiHandLandmarks?: Landmark[][];
}

interface HandsInstance {
  setOptions(options: Record<string, unknown>): void;
  onResults(callback: (results: HandsResults) => void): void;
  initialize(): Promise<void>;
  send(input: { image: HTMLVideoElement }): Promise<void>;
}

declare global {
  interface Window {
    Hands?: new (config: { locateFile: (file: string) => string }) => HandsInstance;
  }
}

let instance: Promise<HandsInstance> | null = null;
let onResults: (results: HandsResults) => void = () => undefined;

/** 콜백을 항상 최신 것으로 교체해 오래된 값을 붙잡는 일이 없게 한다. */
export function setResultsHandler(handler: (results: HandsResults) => void) {
  onResults = handler;
}

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Hands) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `${BASE}/hands.js`;
    script.async = true;
    script.onload = () => (window.Hands ? resolve() : reject(new Error('Hands를 찾을 수 없습니다')));
    script.onerror = () => reject(new Error('손 인식 스크립트를 불러오지 못했습니다'));
    document.head.appendChild(script);
  });
}

export function getHands(): Promise<HandsInstance> {
  if (instance) return instance;
  const created = (async () => {
    await loadScript();
    const Hands = window.Hands;
    if (!Hands) throw new Error('Hands를 찾을 수 없습니다');
    const hands = new Hands({ locateFile: (file) => `${BASE}/${file}` });
    hands.setOptions({
      selfieMode: true,
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.55,
    });
    hands.onResults((results) => onResults(results));
    await hands.initialize();
    return hands;
  })();
  instance = created;
  created.catch(() => {
    if (instance === created) instance = null;
  });
  return created;
}
