'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { AGENTS, type AgentId, type StepStatus } from '@/lib/contracts';
import { AGENT_ICONS } from '@/components/glass';
import { useMissions } from '@/context/MissionsContext';
import { isActive } from '@/lib/missions/reducer';
import { emptyModel, syncTeam, type LiquidModel, type TeamPlacement } from './liquid';
import LiquidLayer from './LiquidLayer';
import { Orb } from './Orb';

const ORDER: AgentId[] = ['researcher', 'archivist', 'operator', 'planner', 'writer', 'analyst'];

export interface TeamDropletsProps {
  /** 묶음 전체 폭(px) */
  size?: number;
  /** 장식이면 보조기기에 읽히지 않는다 */
  decorative?: boolean;
  /** 화면에 보일 때만 움직인다 */
  active?: boolean;
  className?: string;
}

/** 지금 실제로 일하는 에이전트와 그 상태. 진행 중인 미션에서만 읽는다. */
function useWorkingAgents(): Map<AgentId, StepStatus> {
  const { missions } = useMissions();
  return useMemo(() => {
    const working = new Map<AgentId, StepStatus>();
    for (const m of Object.values(missions)) {
      if (!isActive(m.status)) continue;
      if (m.status === 'planning' || m.status === 'synthesizing') working.set('conductor', 'running');
      for (const id of m.stepOrder) {
        const s = m.steps[id];
        if (s?.status === 'running' && !working.has(s.step.agent)) working.set(s.step.agent, 'running');
        // 같은 에이전트가 동시에 일해도 승인 대기가 있으면 그것을 먼저 보여 준다.
        if (s?.status === 'awaiting_approval') working.set(s.step.agent, 'awaiting_approval');
      }
    }
    return working;
  }, [missions]);
}

function placeTeam(size: number): TeamPlacement[] {
  const center = size / 2;
  const orbit = size * 0.335;
  const small = Math.round(size * 0.27);
  const hub = Math.round(size * 0.33);
  return [
    { id: 'conductor', x: center, y: center, size: hub, color: `var(${AGENTS.conductor.colorVar})` },
    ...ORDER.map((agent, i) => {
      const a = (Math.PI * 2 * i) / ORDER.length - Math.PI / 2;
      return { id: agent, x: center + orbit * Math.cos(a), y: center + orbit * Math.sin(a), size: small, color: `var(${AGENTS[agent].colorVar})` };
    }),
  ];
}

/**
 * 팀. 쉬는 동안에는 마른 유리구 일곱 개가 가만히 있다: 색은 테두리와 아이콘에만 있고, 액체도 관도 움직임도 없다.
 * 진행 중인 미션에서 실제로 일하는 에이전트만 지휘자에게서 액체를 받는다. 미션 스테이지와 같은 렌더러를 쓴다.
 */
export default function TeamDroplets({ size = 176, decorative = false, active = true, className }: TeamDropletsProps) {
  const reduce = useReducedMotion();
  const working = useWorkingAgents();
  const model = useRef<LiquidModel>(emptyModel());
  const placements = useMemo(() => placeTeam(size), [size]);

  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  const workingKey = Array.from(working, ([agent, status]) => `${agent}:${status}`).sort().join(',');
  // 자식(LiquidLayer)의 일반 효과보다 먼저 돌아야 첫 프레임부터 그려진다.
  useLayoutEffect(() => {
    const states = new Map(workingKey ? workingKey.split(',').map((entry) => entry.split(':') as [string, string]) : []);
    syncTeam(model.current, placements, states, performance.now(), size);
  }, [placements, workingKey, size]);

  const count = working.size;

  return (
    <span
      className={`team-droplets ${className ?? ''}`}
      data-working={count > 0 ? '' : undefined}
      style={{ width: size, height: size }}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : count > 0 ? `에이전트 7명 중 ${count}명이 일하고 있어요` : '에이전트 7명이 쉬고 있어요'}
    >
      <LiquidLayer
        model={model}
        width={size}
        height={size}
        running={active && visible && !reduce}
        frozen={Boolean(reduce)}
        version={`${workingKey}|${size}`}
        blur={Math.max(1.4, size * 0.01)}
      />
      {placements.map((p) => (
        <span key={p.id} className="team-droplets-orb" style={{ left: p.x - p.size / 2, top: p.y - p.size / 2, width: p.size, height: p.size }}>
          <Orb size={p.size} status={working.get(p.id as AgentId) ?? 'idle'} tint={p.color} icon={AGENT_ICONS[p.id as AgentId]} poolId={p.id} />
        </span>
      ))}
    </span>
  );
}
