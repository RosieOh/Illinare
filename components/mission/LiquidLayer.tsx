'use client';

import { useEffect, useId, useRef, type RefObject } from 'react';
import { frameAt, needsAnimation, STREAM_ENTRY, type EdgeFrame, type LiquidFrame, type LiquidModel, type PoolFrame } from './liquid';

const FRAME_MS = 1000 / 30;
const MAX_BLOBS = 120;
/** 목과 물방울은 부드러워서 해상도를 낮춰도 티가 나지 않는다. 필터 비용을 여기서 막는다. */
const DPR_CAP = 1.5;
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface LiquidLayerProps {
  model: RefObject<LiquidModel>;
  width: number;
  height: number;
  /** 움직여도 되는가 (뷰가 보이고, 창이 보이는 동안) */
  running: boolean;
  /** 모션 감소: 움직임 없이 수위만 그린다 */
  frozen: boolean;
  /** 이 값이 바뀌면 모델이 바뀐 것이므로 다시 깨어난다 */
  version: string;
  /** 끈적임 정도 (작은 구에는 작게) */
  blur?: number;
  className?: string;
}

function setAttr(el: Element, name: string, value: string) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** 구 하나의 액체 요소들. Orb가 만들어 두고 렌더러가 값을 쓴다. */
interface OrbParts {
  root: HTMLElement;
  body: Element;
  disc: Element;
  front: Element;
  fill: Element;
  rivers: Element;
  colorKey: string;
  waterline: string;
  wet: boolean;
}

function collectOrbs(scope: Element | null): Map<string, OrbParts> {
  const orbs = new Map<string, OrbParts>();
  if (!scope) return orbs;
  for (const root of scope.querySelectorAll<HTMLElement>('[data-pool-id]')) {
    const part = (name: string) => root.querySelector(`[data-part="${name}"]`);
    const [body, disc, front, fill, rivers] = [part('body'), part('disc'), part('front'), part('fill'), part('rivers')];
    if (body && disc && front && fill && rivers) orbs.set(root.dataset.poolId ?? '', { root, body, disc, front, fill, rivers, colorKey: '', waterline: '', wet: false });
  }
  return orbs;
}

/**
 * 관과 물방울 층. 구 안의 액체는 여기 없다: 끈적임 필터가 수면을 깎아 벽에서 떨어뜨리기 때문에
 * 각 구가 필터 없는 벡터로 직접 그린다 (Orb). 이 층은 벽 바깥의 것만 그린다.
 * React는 뼈대만 만들고 프레임마다의 값은 직접 쓴다. 30fps로 제한하고, 그릴 것이 없으면 멈춘다.
 */
export default function LiquidLayer({ model, width, height, running, frozen, version, blur = 3.4, className }: LiquidLayerProps) {
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const filterId = `liquid${baseId}`;
  const maskId = `liquid-mask${baseId}`;
  const holesRef = useRef<SVGGElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gooRef = useRef<SVGGElement>(null);
  const necksRef = useRef<SVGGElement>(null);
  const thinRef = useRef<SVGGElement>(null);
  const blobsRef = useRef<SVGGElement>(null);
  const fadesRef = useRef<SVGDefsElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const goo = gooRef.current;
    const necks = necksRef.current;
    const thin = thinRef.current;
    const blobs = blobsRef.current;
    const holes = holesRef.current;
    const fades = fadesRef.current;
    if (!svg || !goo || !necks || !thin || !blobs || !holes || !fades) return;
    const scope = svg.parentElement;
    let orbs = collectOrbs(scope);

    const paint = (frame: LiquidFrame) => {
      if (frame.pools.some((pool) => !orbs.has(pool.id))) orbs = collectOrbs(scope);
      for (const pool of frame.pools) {
        const orb = orbs.get(pool.id);
        if (orb) paintOrb(orb, pool);
      }
      paintHoles(holes, frame);
      const thick = paintEdges(necks, thin, fades, filterId, frame.edges);
      const beads = paintBlobs(blobs, frame);
      // 흐르는 것이 없으면 필터를 아예 돌리지 않는다.
      const empty = thick === 0 && beads === 0;
      if ((goo.style.display === 'none') !== empty) goo.style.display = empty ? 'none' : '';
    };

    if (frozen || !running) {
      paint(frameAt(model.current, performance.now(), frozen));
      return;
    }

    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = 0;
      if (document.hidden) return;
      if (now - last >= FRAME_MS - 1) {
        last = now;
        paint(frameAt(model.current, now));
      }
      if (needsAnimation(model.current, now)) raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(tick);
    };
    paint(frameAt(model.current, performance.now()));
    wake();
    document.addEventListener('visibilitychange', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [model, running, frozen, version, filterId]);

  // 큰 화면에서 필터 비용을 막기 위해 낮은 해상도로 그린 뒤 확대한다.
  const scale = typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio / DPR_CAP);

  return (
    <svg
      ref={svgRef}
      className={`liquid-layer ${className ?? ''}`}
      viewBox={`0 0 ${width} ${height}`}
      width={width / scale}
      height={height / scale}
      style={scale > 1 ? { transform: `scale(${scale})`, transformOrigin: '0 0', willChange: 'transform' } : undefined}
      aria-hidden="true"
    >
      <defs>
        <filter id={filterId} filterUnits="userSpaceOnUse" x="0" y="0" width={width} height={height} colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="soft" />
          {/* 문턱값: 가까운 방울끼리 이어지고, 목이 가늘어지면 끊어진다. 완만한 경사라 가장자리가 계단지지 않는다 */}
          <feColorMatrix in="soft" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 12 -5" result="goo" />
          {/* 젖은 표면의 윤기 */}
          <feGaussianBlur in="goo" stdDeviation={blur * 0.8} result="depth" />
          <feSpecularLighting in="depth" surfaceScale="3.5" specularConstant="0.75" specularExponent="24" lightingColor="#ffffff" result="spec">
            <feDistantLight azimuth="235" elevation="58" />
          </feSpecularLighting>
          <feComposite in="spec" in2="goo" operator="in" result="wet" />
          <feComposite in="goo" in2="wet" operator="arithmetic" k1="0" k2="1" k3="0.62" k4="0" />
        </filter>
        {/* 관은 벽을 넘어 유리 안까지 들어오고, 거기서부터는 구가 벽을 타고 수면까지 이어 그린다 */}
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}>
          <rect x="0" y="0" width={width} height={height} fill="#fff" />
          <g ref={holesRef} fill="#000" />
        </mask>
      </defs>
      <defs ref={fadesRef} />
      <g ref={thinRef} />
      <g mask={`url(#${maskId})`}>
        <g ref={gooRef} className="liquid-goo" filter={`url(#${filterId})`}>
          <g ref={necksRef} />
          <g ref={blobsRef} />
        </g>
      </g>
    </svg>
  );
}

function paintOrb(orb: OrbParts, pool: PoolFrame) {
  setAttr(orb.body, 'd', pool.body);
  setAttr(orb.disc, 'd', pool.disc);
  setAttr(orb.front, 'd', pool.front);

  // 아래에서 위로 쌓인 색을 위에서 아래 순서의 그라디언트로 번지게 한다.
  const key = pool.colors.join(',');
  if (orb.colorKey !== key) {
    orb.colorKey = key;
    const stops = pool.colors.length > 1 ? [...pool.colors].reverse() : [pool.colors[0], pool.colors[0]];
    orb.fill.replaceChildren(
      ...stops.map((color, i) => {
        const stop = document.createElementNS(SVG_NS, 'stop');
        stop.setAttribute('offset', String(i / (stops.length - 1)));
        stop.style.stopColor = color;
        return stop;
      })
    );
  }

  // 액체가 없으면 그 색도 없다. 마른 구의 바닥 빛과 그림자에 아직 오지 않은 액체의 색이 비치면 안 된다.
  const wet = pool.body !== '';
  const top = pool.colors[pool.colors.length - 1];
  if (wet) orb.root.style.setProperty('--pool-top', top);
  else if (orb.wet) orb.root.style.removeProperty('--pool-top');
  orb.wet = wet;

  const waterline = pool.waterline.join();
  if (orb.waterline !== waterline) {
    orb.waterline = waterline;
    orb.root.style.setProperty('--orb-y0', `${pool.waterline[0]}%`);
    orb.root.style.setProperty('--orb-y1', `${pool.waterline[1]}%`);
  }

  pool.rivulets.forEach((rivulet, i) => {
    let el = orb.rivers.children[i] as SVGPathElement | undefined;
    if (!el) {
      el = document.createElementNS(SVG_NS, 'path');
      orb.rivers.appendChild(el);
    }
    setAttr(el, 'd', rivulet.d);
    el.style.stroke = rivulet.color;
    el.style.strokeWidth = rivulet.width.toFixed(3);
    el.style.display = '';
  });
  for (let i = pool.rivulets.length; i < orb.rivers.children.length; i++) (orb.rivers.children[i] as SVGElement).style.display = 'none';
}

/** 흐르는 필라멘트는 끈적임 층의 굵은 목, 나머지는 필터 밖의 얇은 선이다. 굵은 목의 수를 돌려준다. */
function paintEdges(necks: SVGGElement, thin: SVGGElement, fades: SVGDefsElement, idBase: string, edges: EdgeFrame[]): number {
  let thick = 0;
  let line = 0;
  for (const edge of edges) {
    if (edge.stream) {
      let el = necks.children[thick] as SVGPathElement | undefined;
      if (!el) {
        el = document.createElementNS(SVG_NS, 'path');
        necks.appendChild(el);
      }
      let fade = fades.children[thick] as SVGLinearGradientElement | undefined;
      if (!fade) {
        fade = document.createElementNS(SVG_NS, 'linearGradient');
        fade.id = `${idBase}fade${thick}`;
        fade.setAttribute('gradientUnits', 'userSpaceOnUse');
        for (const offset of ['0', '1']) {
          const stop = document.createElementNS(SVG_NS, 'stop');
          stop.setAttribute('offset', offset);
          fade.appendChild(stop);
        }
        fades.appendChild(fade);
      }
      const [x1, y1, x2, y2] = edge.fade;
      setAttr(fade, 'x1', x1.toFixed(1));
      setAttr(fade, 'y1', y1.toFixed(1));
      setAttr(fade, 'x2', x2.toFixed(1));
      setAttr(fade, 'y2', y2.toFixed(1));
      (fade.children[0] as SVGStopElement).style.stopColor = edge.sourceColor;
      (fade.children[1] as SVGStopElement).style.stopColor = edge.color;
      setAttr(el, 'd', edge.stream);
      setAttr(el, 'fill', `url(#${fade.id})`);
      el.style.display = '';
      thick++;
    }
    let el = thin.children[line] as SVGPathElement | undefined;
    if (!el) {
      el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('class', 'filament');
      thin.appendChild(el);
    }
    setAttr(el, 'd', edge.d);
    setAttr(el, 'data-state', edge.state);
    el.style.setProperty('--filament', edge.color);
    el.style.display = '';
    line++;
  }
  for (let i = thick; i < necks.children.length; i++) (necks.children[i] as SVGElement).style.display = 'none';
  for (let i = line; i < thin.children.length; i++) (thin.children[i] as SVGElement).style.display = 'none';
  return thick;
}

function paintHoles(root: SVGGElement, frame: LiquidFrame) {
  frame.pools.forEach((pool, i) => {
    let el = root.children[i] as SVGCircleElement | undefined;
    if (!el) {
      el = document.createElementNS(SVG_NS, 'circle');
      root.appendChild(el);
    }
    setAttr(el, 'cx', pool.cx.toFixed(1));
    setAttr(el, 'cy', pool.cy.toFixed(1));
    setAttr(el, 'r', (pool.r * STREAM_ENTRY).toFixed(1));
  });
  while (root.children.length > frame.pools.length) root.lastChild?.remove();
}

function paintBlobs(root: SVGGElement, frame: LiquidFrame): number {
  const blobs = frame.blobs.slice(0, MAX_BLOBS);
  blobs.forEach((blob, i) => {
    let el = root.children[i] as SVGCircleElement | undefined;
    if (!el) {
      el = document.createElementNS(SVG_NS, 'circle');
      root.appendChild(el);
    }
    el.setAttribute('cx', blob.x.toFixed(1));
    el.setAttribute('cy', blob.y.toFixed(1));
    el.setAttribute('r', Math.max(blob.r, 0).toFixed(2));
    if (el.style.fill !== blob.color) el.style.fill = blob.color;
    el.style.display = '';
  });
  for (let i = blobs.length; i < root.children.length; i++) (root.children[i] as SVGElement).style.display = 'none';
  return blobs.length;
}
