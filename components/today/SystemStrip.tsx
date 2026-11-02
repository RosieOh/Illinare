'use client';

import { statusLine } from '@/components/system/model';
import { useEffect, useState } from 'react';
import { Activity, ChevronRight, TriangleAlert } from 'lucide-react';
import type { SystemSnapshot } from '@/lib/contracts';
import { api } from '@/lib/client/api';

const POLL_MS = 5000;

function useSystem(active: boolean) {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const load = () => {
      if (document.hidden) return;
      api
        .get<SystemSnapshot>('/api/system', controller.signal)
        .then((data) => {
          setSnapshot(data);
          setFailed(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        });
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [active]);

  return { snapshot, failed };
}

/** 숫자를 나열하기 전에 지금 상태를 한 문장으로 말한다. 시스템 화면과 같은 규칙을 쓴다. */
function verdict(s: SystemSnapshot): { text: string; warn: boolean } {
  const line = statusLine(s, []);
  return { text: line.text.replace(/\.$/, ''), warn: line.tone !== 'neutral' };
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-footnote text-label-2">{label}</span>
      <span className="text-subhead font-medium text-label tabular-nums">{value}</span>
    </span>
  );
}

export function SystemStrip({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const { snapshot, failed } = useSystem(active);

  const v = snapshot ? verdict(snapshot) : null;
  const Icon = v?.warn ? TriangleAlert : Activity;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="시스템 화면 열기"
      className="material-thin press flex min-h-12 w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-[16px] px-4 py-2.5 text-left hover:brightness-[1.03]"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon size={15} className={`shrink-0 ${v?.warn ? 'text-warning-text' : v ? 'text-success-text' : 'text-label-2'}`} aria-hidden="true" />
        <span className={`text-subhead font-medium ${v?.warn ? 'text-warning-text' : v ? 'text-label' : 'text-label-2'}`}>
          {v ? v.text : failed ? '시스템 정보를 읽지 못했어요' : '시스템 상태를 읽는 중이에요'}
        </span>
      </span>
      {snapshot && (
        <span className="flex flex-wrap items-baseline gap-x-3.5 gap-y-0.5 @3xl:ml-auto">
          <Metric label="CPU" value={`${Math.round(snapshot.cpuPct)}%`} />
          <Metric label="메모리" value={`${Math.round(snapshot.memPct)}%`} />
          <Metric label="디스크" value={`${Math.round(snapshot.diskPct)}%`} />
          {snapshot.battery && <Metric label="배터리" value={`${Math.round(snapshot.battery.percent)}%`} />}
        </span>
      )}
      <ChevronRight size={15} className={`shrink-0 text-label-3 max-sm:hidden ${snapshot ? '' : 'ml-auto'}`} aria-hidden="true" />
    </button>
  );
}
