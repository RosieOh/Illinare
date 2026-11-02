'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { WallpaperId } from '@/lib/contracts';
import { useMediaQuery } from '@/utils/useMediaQuery';

interface Palette {
  base: string;
  blobs: [string, string, string, string, string];
}

/** 라이트는 명도가 높게, 다크는 낮게 유지해 어느 지점에서도 라벨 대비가 깨지지 않게 한다. */
export const WALLPAPERS: Record<WallpaperId, { label: string; light: Palette; dark: Palette }> = {
  tide: {
    label: '조수',
    light: { base: '#d6e6f7', blobs: ['#9fcdff', '#bdf0e6', '#dcd2ff', '#f8e6d6', '#a9c2ff'] },
    dark: { base: '#081222', blobs: ['#0c3f80', '#0c5a6a', '#2c1f6e', '#0e2c52', '#3a2060'] },
  },
  dune: {
    label: '사구',
    light: { base: '#f6e9d9', blobs: ['#ffd2ac', '#fbc3b3', '#ecdcc4', '#ddcff2', '#ffe9bf'] },
    dark: { base: '#17110e', blobs: ['#5c301c', '#6a3a2a', '#3a2340', '#2b1d13', '#74471f'] },
  },
  aurora: {
    label: '오로라',
    light: { base: '#def3ed', blobs: ['#a8ecd4', '#bcdcff', '#dccbff', '#cff6ba', '#afe3f2'] },
    dark: { base: '#050f14', blobs: ['#0c5043', '#123d73', '#381d70', '#0a4236', '#145549'] },
  },
  graphite: {
    label: '흑연',
    light: { base: '#e7e8eb', blobs: ['#d5d7dd', '#f3f3f5', '#cacdd6', '#dfe0e6', '#c6cad4'] },
    dark: { base: '#0c0c0e', blobs: ['#25252a', '#1b1b1f', '#2d2f37', '#151518', '#35373f'] },
  },
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 정적 대체 배경 — WebGL이 없거나 모션을 줄인 경우에도 같은 분위기를 유지한다. 설정의 미리보기에도 쓴다. */
export function staticBackground(p: Palette): string {
  const [a, b, c, d, e] = p.blobs;
  return [
    `radial-gradient(70% 80% at 14% 10%, ${a}, transparent 70%)`,
    `radial-gradient(60% 70% at 88% 18%, ${b}, transparent 70%)`,
    `radial-gradient(75% 80% at 72% 92%, ${c}, transparent 72%)`,
    `radial-gradient(55% 60% at 22% 82%, ${d}, transparent 70%)`,
    `radial-gradient(45% 50% at 50% 46%, ${e}, transparent 72%)`,
    p.base,
  ].join(', ');
}

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

const FRAG = `precision mediump float;
uniform vec2 u_res;uniform float u_t;uniform vec3 u_base;uniform vec3 u_c[5];uniform float u_lift;uniform float u_warm;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
void main(){
vec2 uv=gl_FragCoord.xy/u_res;float ar=u_res.x/u_res.y;vec2 p=vec2(uv.x*ar,uv.y);
vec2 w=vec2(n(p*1.3+vec2(u_t*.06,0.)),n(p*1.3+vec2(4.7,-u_t*.05)))-.5;p+=w*.62;
vec3 col=u_base;
for(int i=0;i<5;i++){float f=float(i);
vec2 c=vec2((.5+.52*cos(u_t*.043*(1.+f*.31)+f*2.4))*ar,.5+.56*sin(u_t*.037*(1.+f*.27)+f*1.7));
float d=length(p-c);col=mix(col,u_c[i],exp(-d*d*2.2)*.92);}
col=mix(col,col*vec3(1.05,1.,.93),u_warm);
col+=u_lift;
col+=(h(gl_FragCoord.xy+fract(u_t))-.5)/255.*2.;
gl_FragColor=vec4(col,1.);}`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

/** 새벽과 해질녘에 조금 따뜻해진다 (0~1) */
function warmthAt(date: Date): number {
  const hour = date.getHours() + date.getMinutes() / 60;
  const near = (center: number) => Math.max(0, 1 - Math.abs(hour - center) / 2.5);
  return Math.max(near(6.5), near(18.5));
}

export interface WallpaperProps {
  id: WallpaperId;
  theme: 'light' | 'dark';
  /** 미션이 돌고 있으면 true — 흐름이 빨라지고 밝기가 조금 오른다 */
  energized: boolean;
}

export default function Wallpaper({ id, theme, energized }: WallpaperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const palette = WALLPAPERS[id][theme];
  const fallbacks = useMemo(
    () =>
      ({
        '--wp-light': staticBackground(WALLPAPERS[id].light),
        '--wp-dark': staticBackground(WALLPAPERS[id].dark),
      }) as React.CSSProperties,
    [id]
  );

  const target = useRef({ palette, energized });
  useEffect(() => {
    target.current = { palette, energized };
  }, [palette, energized]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || reduceMotion) return;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attrib = gl.getAttribLocation(program, 'a');
    gl.enableVertexAttribArray(attrib);
    gl.vertexAttribPointer(attrib, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, 'u_res');
    const uT = gl.getUniformLocation(program, 'u_t');
    const uBase = gl.getUniformLocation(program, 'u_base');
    const uC = gl.getUniformLocation(program, 'u_c');
    const uLift = gl.getUniformLocation(program, 'u_lift');
    const uWarm = gl.getUniformLocation(program, 'u_warm');

    // 부드러운 그라디언트라 저해상도로 그려 늘려도 티가 나지 않는다.
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 1) * 0.42;
      const w = Math.max(2, Math.floor(window.innerWidth * scale));
      const h = Math.max(2, Math.floor(window.innerHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    const toVec = (p: Palette) => [...hexToRgb(p.base), ...p.blobs.flatMap(hexToRgb)];
    const current = toVec(target.current.palette);
    let energy = target.current.energized ? 1 : 0;
    let warm = warmthAt(new Date());
    // 시작 시점이 매번 달라야 배경이 늘 같은 모양으로 멈춰 있지 않는다.
    let t = new Date().getSeconds() * 7 + new Date().getMinutes() * 31;
    let raf = 0;
    let last = 0;
    let frames = 0;
    const mountedAt = performance.now();

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      // 30fps면 충분하다.
      if (now - last < 32) return;
      const dt = Math.min((now - (last || now)) / 1000, 0.1);
      last = now;

      const goal = toVec(target.current.palette);
      // 시작 직후(설정을 불러오는 동안)에는 바로 맞춰 밝은 배경이 번쩍이지 않게 한다. 이후 변경은 부드럽게 옮겨 간다.
      const blend = now - mountedAt < 1500 ? 1 : Math.min(1, dt * 3);
      for (let i = 0; i < current.length; i++) current[i] += (goal[i] - current[i]) * blend;
      energy += ((target.current.energized ? 1 : 0) - energy) * Math.min(1, dt * 1.4);
      t += dt * (1 + energy * 1.6);
      if (++frames % 900 === 0) warm = warmthAt(new Date());

      gl.uniform1f(uT, t);
      gl.uniform3f(uBase, current[0], current[1], current[2]);
      gl.uniform3fv(uC, new Float32Array(current.slice(3)));
      gl.uniform1f(uLift, energy * 0.022);
      gl.uniform1f(uWarm, warm * 0.55);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      last = 0;
      raf = requestAnimationFrame(draw);
    };
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) start();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    };
  }, [reduceMotion]);

  return (
    <div className="wallpaper" style={fallbacks} aria-hidden="true">
      {!reduceMotion && <canvas ref={canvasRef} />}
    </div>
  );
}
