/**
 * Liquid Glass 렌즈 — 둥근 사각형 가장자리에서 배경을 안쪽으로 끌어오는 변위 맵을 만든다.
 * feDisplacementMap은 R, G 채널을 각각 x, y 이동량으로 읽는다 (128이 0).
 * 크기별로 캐시하고, 부드러운 곡면이라 절반 해상도로도 충분하다.
 */
const cache = new Map<string, LensAssets>();
const CACHE_LIMIT = 48;

export interface LensAssets {
  /** feImage에 넣는 변위 맵 */
  map: string;
  /** 프로스트 층 마스크: 가장자리는 비우고 안쪽만 흐리게 해서 테두리에 또렷한 굴절이 보이게 한다 */
  mask: string;
}

export interface LensSpec {
  width: number;
  height: number;
  radius: number;
  /** 굴절이 일어나는 가장자리 폭 (px) */
  bezel: number;
}

export function lensAssets({ width, height, radius, bezel }: LensSpec): LensAssets | null {
  const key = `${width}x${height}x${radius}x${bezel}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const scale = 0.5;
  const w = Math.max(2, Math.round(width * scale));
  const h = Math.max(2, Math.round(height * scale));
  const r = Math.min(radius, Math.min(width, height) / 2) * scale;
  const b = Math.max(1, bezel * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext('2d');
  if (!ctx || !maskCtx) return null;
  const image = ctx.createImageData(w, h);
  const data = image.data;
  const maskImage = maskCtx.createImageData(w, h);
  const maskData = maskImage.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - w / 2;
      const py = y + 0.5 - h / 2;
      const qx = Math.abs(px) - (w / 2 - r);
      const qy = Math.abs(py) - (h / 2 - r);
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      // 둥근 사각형까지의 부호 거리 — inside는 가장자리에서 안쪽으로 잰 거리
      const inside = -(Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r);

      let nx = 0;
      let ny = 0;
      let magnitude = 0;
      if (inside >= 0 && inside < b) {
        // 볼록 렌즈 곡면: 가장자리에서 가장 크게 꺾이고 안쪽으로 빠르게 줄어든다.
        const t = 1 - inside / b;
        magnitude = t * t * (3 - 2 * t) * t;
        if (qx > 0 && qy > 0) {
          const len = Math.hypot(ox, oy) || 1;
          nx = -(ox / len) * Math.sign(px);
          ny = -(oy / len) * Math.sign(py);
        } else if (qx > qy) {
          nx = -Math.sign(px);
        } else {
          ny = -Math.sign(py);
        }
      }

      const i = (y * w + x) * 4;
      data[i] = 128 + nx * magnitude * 127;
      data[i + 1] = 128 + ny * magnitude * 127;
      data[i + 2] = 128;
      data[i + 3] = 255;

      const feather = Math.min(Math.max(inside / b, 0), 1);
      maskData[i + 3] = feather * feather * (3 - 2 * feather) * 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  maskCtx.putImageData(maskImage, 0, 0);
  const assets: LensAssets = { map: canvas.toDataURL('image/png'), mask: maskCanvas.toDataURL('image/png') };
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, assets);
  return assets;
}

let supported: boolean | null = null;

/** backdrop-filter: url()은 크로뮴 계열에서만 동작한다. Safari, Firefox는 블러만 쓴다. */
export function supportsLens(): boolean {
  if (supported !== null) return supported;
  supported =
    typeof window !== 'undefined' &&
    typeof CSS !== 'undefined' &&
    CSS.supports('backdrop-filter', 'url(#a)') &&
    /Chrom(e|ium)\//.test(navigator.userAgent);
  return supported;
}
