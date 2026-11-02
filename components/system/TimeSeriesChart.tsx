'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatClock } from '@/lib/client/format';
import { nearestIndex, splitAtGaps, type Point } from './model';

export interface ChartSeries {
  id: string;
  label: string;
  /** CSS 색 (var(--...) 허용) */
  color: string;
  points: Point[];
}

interface TimeSeriesChartProps {
  series: ChartSeries[];
  /** 창의 오른쪽 끝 시각 */
  end: number;
  windowMs: number;
  yMax: number;
  yTicks: number[];
  formatTick: (value: number) => string;
  formatValue: (value: number) => string;
  height: number;
  /** 값을 받지 못하는 동안 흐리게 유지한다 */
  stale?: boolean;
  /** 보조기기용 이름. 값 요약을 포함할 것 */
  ariaLabel: string;
  yAxisWidth?: number;
}

const M = { top: 8, right: 10, bottom: 22 };

function pathOf(points: Point[], x: (at: number) => number, y: (v: number) => number): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)} ${y(p.value).toFixed(1)}`).join('');
}

/**
 * 실시간 시계열 차트. 선 2px, 영역은 10% 워시, 격자는 머리카락 굵기.
 * 십자선이 가장 가까운 표본으로 붙고, 키보드 좌우 키로도 같은 값을 읽을 수 있다.
 */
export function TimeSeriesChart({
  series,
  end,
  windowMs,
  yMax,
  yTicks,
  formatTick,
  formatValue,
  height,
  stale,
  ariaLabel,
  yAxisWidth = 42,
}: TimeSeriesChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  /** 값이 흘러가도 같은 표본을 가리키도록 위치 대신 시각을 기억한다 */
  const [cursorAt, setCursorAt] = useState<number | null>(null);
  const [viaKeyboard, setViaKeyboard] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const plotW = Math.max(0, width - yAxisWidth - M.right);
  const plotH = height - M.top - M.bottom;
  const start = end - windowMs;
  const x = (at: number) => yAxisWidth + ((at - start) / windowMs) * plotW;
  const y = (v: number) => M.top + plotH - (Math.min(v, yMax) / yMax) * plotH;

  const xTicks = useMemo(() => {
    const minuteMs = 60_000;
    // 좁은 폭에서는 라벨이 겹치지 않게 간격을 넓힌다.
    const every = plotW < 300 ? 2 : 1;
    const ticks: number[] = [];
    const first = Math.floor(end / minuteMs) * minuteMs;
    for (let t = first; t >= start + minuteMs * 0.3; t -= minuteMs * every) ticks.push(t);
    return ticks;
  }, [end, start, plotW]);

  const reference = series[0]?.points ?? [];
  const hoverIndex = cursorAt === null ? -1 : nearestIndex(reference, cursorAt);
  const hover = hoverIndex >= 0 ? reference[hoverIndex] : null;

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!plotW) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    setViaKeyboard(false);
    setCursorAt(start + ((px - yAxisWidth) / plotW) * windowMs);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!reference.length) return;
    if (e.key === 'Escape') {
      setCursorAt(null);
      return;
    }
    const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    const from = hoverIndex >= 0 ? hoverIndex : reference.length;
    const next = Math.min(reference.length - 1, Math.max(0, from + delta));
    setViaKeyboard(true);
    setCursorAt(reference[next].at);
  };

  const tooltipLeft = hover ? x(hover.at) : 0;
  const flip = tooltipLeft > width / 2;

  return (
    <div
      ref={box}
      className="relative rounded-[8px] select-none"
      style={{ height, opacity: stale ? 0.5 : 1, transition: 'opacity .2s' }}
      role="group"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setCursorAt(null)}
      onKeyDown={onKeyDown}
      onBlur={() => setCursorAt(null)}
    >
      {width > 0 && (
        <svg width={width} height={height} aria-hidden="true" className="block">
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={yAxisWidth} x2={width - M.right} y1={y(tick)} y2={y(tick)} stroke="var(--separator)" />
              <text x={yAxisWidth - 8} y={y(tick)} dy="0.34em" textAnchor="end" fontSize={11} fill="var(--label-3)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatTick(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => {
            // 오른쪽 끝에 붙은 라벨은 끝을 맞춰 잘리지 않게 한다.
            const atEdge = x(tick) > width - 24;
            return (
              <text
                key={tick}
                x={atEdge ? width - 1 : x(tick)}
                y={height - 5}
                textAnchor={atEdge ? 'end' : 'middle'}
                fontSize={11}
                fill="var(--label-3)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatClock(tick)}
              </text>
            );
          })}

          {series.map((s) => {
            const segments = splitAtGaps(s.points);
            const last = s.points[s.points.length - 1];
            return (
              <g key={s.id}>
                {series.length === 1 &&
                  segments.map((seg) => (
                    <path
                      key={`a${seg[0].at}`}
                      d={`${pathOf(seg, x, y)}L${x(seg[seg.length - 1].at).toFixed(1)} ${y(0).toFixed(1)}L${x(seg[0].at).toFixed(1)} ${y(0).toFixed(1)}Z`}
                      fill={s.color}
                      opacity={0.1}
                    />
                  ))}
                {segments.map((seg) => (
                  <path key={`l${seg[0].at}`} d={pathOf(seg, x, y)} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                ))}
                {last && !hover && <circle cx={x(last.at)} cy={y(last.value)} r={4} fill={s.color} stroke="var(--surface-2)" strokeWidth={2} />}
              </g>
            );
          })}

          {hover && (
            <g>
              <line x1={x(hover.at)} x2={x(hover.at)} y1={M.top} y2={M.top + plotH} stroke="var(--label-3)" strokeWidth={1} />
              {series.map((s) => {
                const p = s.points[nearestIndex(s.points, hover.at)];
                return p ? <circle key={s.id} cx={x(p.at)} cy={y(p.value)} r={4} fill={s.color} stroke="var(--surface-2)" strokeWidth={2} /> : null;
              })}
            </g>
          )}
        </svg>
      )}

      {hover && (
        <div
          role={viaKeyboard ? 'status' : undefined}
          className="pointer-events-none absolute top-1 rounded-[10px] bg-surface-2 px-2.5 py-1.5 shadow-[0_6px_20px_rgba(0,0,0,.18),0_0_0_0.5px_var(--separator)]"
          style={flip ? { right: width - tooltipLeft + 10 } : { left: tooltipLeft + 10 }}
        >
          <div className="text-caption whitespace-nowrap text-label-2">{formatClock(hover.at)}</div>
          {series.map((s) => {
            const p = s.points[nearestIndex(s.points, hover.at)];
            return (
              <div key={s.id} className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                <span className="text-footnote font-semibold text-label tabular-nums">{p ? formatValue(p.value) : '없음'}</span>
                <span className="text-caption text-label-2">{s.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
