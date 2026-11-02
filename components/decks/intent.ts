/** 팔레트 명령이 발표 뷰에 "바로 발표를 시작해 달라"고 전하는 통로. 뷰가 아직 마운트되지 않았어도 요청이 남아 있다. */
let pending = false;
const listeners = new Set<() => void>();

export function requestPresentation() {
  pending = true;
  listeners.forEach((fn) => fn());
}

export function consumePresentationRequest(): boolean {
  const value = pending;
  pending = false;
  return value;
}

export function subscribePresentationRequest(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
