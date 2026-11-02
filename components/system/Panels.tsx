'use client';

import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Cpu as CpuIcon, Table2 } from 'lucide-react';
import type { ProcessInfo, SystemSnapshot } from '@/lib/contracts';
import { Button, Material, ProgressBar } from '@/components/glass';
import { useApp } from '@/context/AppContext';
import { formatClock } from '@/lib/client/format';
import { TimeSeriesChart } from './TimeSeriesChart';
import {
  cpuSummary,
  formatGb,
  formatMb,
  formatRate,
  formatUptime,
  chartWindowMs,
  meterTone,
  niceCeiling,
  topBy,
  type ProcessSort,
  type Sample,
} from './model';

// ─── CPU ─────────────────────────────────────────────────────
export function CpuPanel({ snapshot, history, stale }: { snapshot: SystemSnapshot; history: Sample[]; stale: boolean }) {
  const [showTable, setShowTable] = useState(false);
  const summary = cpuSummary(history);
  const points = useMemo(() => history.map((s) => ({ at: s.at, value: s.cpu })), [history]);
  const current = Math.round(snapshot.cpuPct);
  const ariaLabel = summary
    ? `CPU 사용률 그래프. 지금 ${current}%, ${summary.label} 평균 ${Math.round(summary.avg)}%, 최고 ${Math.round(summary.max)}%. 좌우 방향키로 시점별 값을 읽을 수 있어요.`
    : `CPU 사용률 지금 ${current}%`;

  return (
    <Material as="section" className="min-w-0 p-5" radius={24} aria-label="CPU">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-headline text-label">CPU</h2>
          <p className="truncate text-subhead text-label-2" title={snapshot.cpuModel}>
            {snapshot.cpuModel}
          </p>
        </div>
        <Button
          variant="plain"
          size="sm"
          icon={showTable ? CpuIcon : Table2}
          aria-expanded={showTable}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? '차트로 보기' : '표로 보기'}
        </Button>
      </header>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-[3rem] leading-none font-semibold tracking-[-0.03em] text-label tabular-nums">
          {current}
          <span className="ml-0.5 text-title2 font-semibold text-label-2">%</span>
        </span>
        {summary && (
          <span className="text-subhead text-label-2 tabular-nums">
            {summary.label} 평균 {Math.round(summary.avg)}% · 최고 {Math.round(summary.max)}%
          </span>
        )}
      </div>

      {showTable ? (
        <CpuTable history={history} />
      ) : (
        <div className="mt-3">
          <TimeSeriesChart
            series={[{ id: 'cpu', label: 'CPU', color: 'var(--accent)', points }]}
            end={snapshot.at}
            windowMs={chartWindowMs(history, snapshot.at)}
            yMax={100}
            yTicks={[0, 50, 100]}
            formatTick={(v) => `${v}%`}
            formatValue={(v) => `${v.toFixed(0)}%`}
            height={216}
            stale={stale}
            ariaLabel={ariaLabel}
          />
        </div>
      )}

      <CoreBars perCore={snapshot.perCore} stale={stale} />
    </Material>
  );
}

function CpuTable({ history }: { history: Sample[] }) {
  const rows = history.slice(-10).reverse();
  return (
    <table className="mt-3 w-full text-callout">
      <caption className="sr-only">최근 CPU 사용률 표본</caption>
      <thead>
        <tr className="border-b border-separator text-left text-footnote text-label-2">
          <th scope="col" className="py-1.5 font-medium">시각</th>
          <th scope="col" className="py-1.5 text-right font-medium">사용률</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.at} className="border-b border-separator last:border-b-0">
            <td className="py-1.5 text-label-2 tabular-nums">
              {new Date(s.at).toLocaleTimeString('ko-KR', { hour12: false })}
            </td>
            <td className="py-1.5 text-right text-label tabular-nums">{s.cpu.toFixed(0)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CoreBars({ perCore, stale }: { perCore: number[]; stale: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const average = perCore.length ? perCore.reduce((a, b) => a + b, 0) / perCore.length : 0;
  const shown = active !== null && active < perCore.length ? active : null;

  const onKeyDown = (e: KeyboardEvent) => {
    const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!delta || !perCore.length) return;
    e.preventDefault();
    setActive((cur) => {
      const from = cur ?? (delta > 0 ? -1 : perCore.length);
      return Math.min(perCore.length - 1, Math.max(0, from + delta));
    });
  };

  return (
    <div className="mt-4 border-t border-separator pt-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-subhead font-medium text-label-2">코어 {perCore.length}개</h3>
        <span className="text-footnote text-label-2 tabular-nums" role={shown !== null ? 'status' : undefined}>
          {shown !== null ? `코어 ${shown + 1} · ${perCore[shown].toFixed(0)}%` : `평균 ${average.toFixed(0)}%`}
        </span>
      </div>
      <div
        className="flex h-12 items-end gap-0.5 rounded-[6px]"
        style={{ opacity: stale ? 0.5 : 1, transition: 'opacity .2s' }}
        role="group"
        aria-label={`코어별 사용률. ${perCore.map((v, i) => `코어 ${i + 1} ${v.toFixed(0)}%`).join(', ')}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
      >
        {perCore.map((value, i) => (
          <div
            key={i}
            className="relative h-full min-w-0 flex-1"
            style={{ maxWidth: 24 }}
            onPointerEnter={() => setActive(i)}
          >
            <div className="absolute inset-0 rounded-t-[4px] bg-fill-4" />
            <div
              className="absolute inset-x-0 bottom-0 rounded-t-[4px]"
              style={{
                height: `${Math.min(100, Math.max(value, 1.5))}%`,
                background: 'var(--accent)',
                opacity: shown !== null && shown !== i ? 0.55 : 1,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 자원 ─────────────────────────────────────────────────────
function Row({ title, value, detail, children }: { title: string; value: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-callout font-medium text-label">{title}</h3>
        <span className="text-callout font-semibold text-label tabular-nums">{value}</span>
      </div>
      {detail && <p className="mt-0.5 text-footnote text-label-2 tabular-nums">{detail}</p>}
      {children}
    </div>
  );
}

export function ResourcesPanel({ snapshot }: { snapshot: SystemSnapshot }) {
  const { battery, load1m } = snapshot;
  return (
    <Material as="section" className="min-w-0 divide-y divide-separator p-5" radius={24} aria-label="자원">
      <Row title="메모리" value={`${snapshot.memPct.toFixed(0)}%`} detail={`${formatGb(snapshot.memUsedGb)} / ${formatGb(snapshot.memTotalGb)} 사용`}>
        <ProgressBar value={snapshot.memPct / 100} label="메모리 사용률" tone={meterTone(snapshot.memPct)} className="mt-2" />
      </Row>
      <Row title="디스크" value={`${snapshot.diskPct.toFixed(0)}%`} detail={`${formatGb(snapshot.diskUsedGb)} / ${formatGb(snapshot.diskTotalGb)} 사용`}>
        <ProgressBar value={snapshot.diskPct / 100} label="디스크 사용률" tone={meterTone(snapshot.diskPct)} className="mt-2" />
      </Row>
      {battery && (
        <Row title="배터리" value={`${Math.round(battery.percent)}%`} detail={battery.charging ? '충전 중' : '배터리 사용 중'}>
          <ProgressBar
            value={battery.percent / 100}
            label="배터리 잔량"
            tone={!battery.charging && battery.percent <= 10 ? 'danger' : !battery.charging && battery.percent <= 20 ? 'warning' : 'accent'}
            className="mt-2"
          />
        </Row>
      )}
      {load1m !== null && <Row title="1분 평균 부하" value={load1m.toFixed(2)} />}
      <Row title="가동 시간" value={formatUptime(snapshot.uptimeSec)} />
      <div className="pt-3.5 text-footnote text-label-2">
        <p className="truncate" title={snapshot.hostname}>{snapshot.hostname}</p>
        <p className="truncate" title={snapshot.platform}>{snapshot.platform}</p>
      </div>
    </Material>
  );
}

// ─── 네트워크 ────────────────────────────────────────────────
/** 범주 색 한 쌍. 라이트/다크 각각 validate_palette를 통과했다. 상태색과 겹치지 않게 골랐다. */
const NETWORK_COLORS = {
  light: { rx: '#007aff', tx: '#c2388f' },
  dark: { rx: '#0a84ff', tx: '#e0559f' },
} as const;

/** 두 선 모두 같은 단위이므로 축 하나를 함께 쓴다. */
export function NetworkPanel({ snapshot, history, stale }: { snapshot: SystemSnapshot; history: Sample[]; stale: boolean }) {
  const { resolvedTheme } = useApp();
  const colors = NETWORK_COLORS[resolvedTheme];
  const rx = useMemo(() => history.flatMap((s) => (s.rx === null ? [] : [{ at: s.at, value: s.rx }])), [history]);
  const tx = useMemo(() => history.flatMap((s) => (s.tx === null ? [] : [{ at: s.at, value: s.tx }])), [history]);
  const net = snapshot.network;
  if (!net) return null;
  const yMax = niceCeiling(Math.max(1, ...rx.map((p) => p.value), ...tx.map((p) => p.value)));
  return (
    <Material as="section" className="min-w-0 p-5" radius={24} aria-label="네트워크">
      <h2 className="text-headline text-label">네트워크</h2>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
        <LegendValue color={colors.rx} label="수신" value={formatRate(net.rxBps)} />
        <LegendValue color={colors.tx} label="송신" value={formatRate(net.txBps)} />
      </dl>
      <div className="mt-2">
        <TimeSeriesChart
          series={[
            { id: 'rx', label: '수신', color: colors.rx, points: rx },
            { id: 'tx', label: '송신', color: colors.tx, points: tx },
          ]}
          end={snapshot.at}
          windowMs={chartWindowMs(history, snapshot.at)}
          yMax={yMax}
          yTicks={[0, yMax]}
          formatTick={(v) => (v === 0 ? '0' : formatRate(v))}
          formatValue={formatRate}
          height={120}
          stale={stale}
          yAxisWidth={68}
          ariaLabel={`네트워크 전송량 그래프. 지금 수신 ${formatRate(net.rxBps)}, 송신 ${formatRate(net.txBps)}.`}
        />
      </div>
    </Material>
  );
}

function LegendValue({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-0.5 w-3.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      <dt className="text-footnote text-label-2">{label}</dt>
      <dd className="text-footnote font-semibold text-label tabular-nums">{value}</dd>
    </div>
  );
}

// ─── 프로세스 ────────────────────────────────────────────────
function SortHeader({ label, sort, current, onSort }: { label: string; sort: ProcessSort; current: ProcessSort; onSort: (s: ProcessSort) => void }) {
  const on = sort === current;
  const Icon = on ? ChevronDown : ChevronUp;
  return (
    <th scope="col" aria-sort={on ? 'descending' : 'none'} className={`py-1.5 text-right font-medium ${sort === 'cpu' ? 'w-[72px] @xl:w-24' : 'w-[84px] @xl:w-28'}`}>
      <button
        type="button"
        onClick={() => onSort(sort)}
        className={`press inline-flex items-center gap-0.5 rounded-md px-1 ${on ? 'text-label' : 'text-label-2 hover:text-label'}`}
      >
        {label}
        <Icon size={13} className={on ? '' : 'opacity-0'} aria-hidden="true" />
      </button>
    </th>
  );
}

export function ProcessesPanel({ processes, pending }: { processes: ProcessInfo[]; pending: boolean }) {
  const [sort, setSort] = useState<ProcessSort>('cpu');
  const rows = topBy(processes, sort === 'cpu' ? 'cpuPct' : 'memMb');
  return (
    <Material as="section" className="min-w-0 p-5" radius={24} aria-label="프로세스">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 className="text-headline text-label">프로세스</h2>
        <p className="text-footnote text-label-2">이름이 같은 프로세스는 합쳐서 보여줘요.</p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-callout text-label-2">
          {pending ? '프로세스 목록을 읽는 중이에요.' : '이 환경에서는 프로세스 목록을 읽지 못했어요.'}
        </p>
      ) : (
        <table className="mt-2 w-full table-fixed text-callout">
          <caption className="sr-only">사용량 상위 프로세스 {rows.length}개</caption>
          <thead>
            <tr className="border-b border-separator text-left text-footnote text-label-2">
              <th scope="col" className="py-1.5 font-medium">이름</th>
              <SortHeader label="CPU" sort="cpu" current={sort} onSort={setSort} />
              <SortHeader label="메모리" sort="mem" current={sort} onSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.name} className="border-b border-separator last:border-b-0">
                <td className="truncate py-[7px] pr-3 text-label" title={p.name}>{p.name}</td>
                <td className="py-[7px] pr-[18px] text-right text-label-2 tabular-nums">{p.cpuPct.toFixed(1)}%</td>
                <td className="py-[7px] pr-[18px] text-right text-label-2 tabular-nums">{formatMb(p.memMb)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Material>
  );
}

export function StaleBanner({ error, lastOkAt, onRetry }: { error: string; lastOkAt: number | null; onRetry: () => void }) {
  return (
    <div role="status" className="material-thin mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[16px] px-4 py-2.5">
      <p className="min-w-0 text-callout text-label">
        측정값을 받지 못하고 있어요{lastOkAt ? ` · ${formatClock(lastOkAt)}에 마지막으로 받았어요` : ''}
        <span className="block text-footnote text-label-2">{error}</span>
      </p>
      <Button size="sm" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
}
