import {
  CalendarCheck,
  ChartLine,
  FolderOpen,
  Globe,
  PenLine,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { AGENTS, type AgentId, type StepStatus } from '@/lib/contracts';

export const AGENT_ICONS: Record<AgentId, LucideIcon> = {
  conductor: Sparkles,
  researcher: Globe,
  archivist: FolderOpen,
  operator: SlidersHorizontal,
  planner: CalendarCheck,
  writer: PenLine,
  analyst: ChartLine,
};

/** 일하고 있음을 뜻하는 상태. 나머지는 마른 유리다: 정적인 목록의 아바타가 일하는 것처럼 보이면 안 된다. */
const WET_STATUS: ReadonlySet<StepStatus> = new Set(['running', 'awaiting_approval', 'done']);

const SIZES = { xs: 22, sm: 28, md: 36, lg: 48, xl: 64 } as const;

export interface AgentAvatarProps {
  agent: AgentId;
  /** xs 22, sm 28, md 36, lg 48, xl 64 또는 직접 px */
  size?: keyof typeof SIZES | number;
  /** 상태 링. 생략하면 링 없음 */
  status?: StepStatus;
  /** 상태와 상관없이 지금 실제로 일하고 있으면 true. 액체가 찬 모습이 된다 */
  working?: boolean;
  /** 장식이면 true (보조기기에 읽히지 않음) */
  decorative?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** 에이전트를 나타내는 유리 방울. 쉴 때는 색 테두리의 마른 유리이고 일할 때만 액체가 찬다. 링은 진행 상태. */
export function AgentAvatar({ agent, size = 'md', status, working, decorative, className, style }: AgentAvatarProps) {
  const px = typeof size === 'number' ? size : SIZES[size];
  const meta = AGENTS[agent];
  const Icon = AGENT_ICONS[agent];
  const dim = status === 'pending' || status === 'skipped' || status === 'cancelled';
  const wet = working || (status !== undefined && WET_STATUS.has(status));
  return (
    <span
      className={`droplet ${className ?? ''}`}
      data-agent={agent}
      data-wet={wet ? '' : undefined}
      data-dim={dim ? '' : undefined}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : meta.name}
      style={{ width: px, height: px, '--droplet': `var(${meta.colorVar})`, ...style } as React.CSSProperties}
    >
      <Icon size={Math.round(px * 0.52)} strokeWidth={2.1} aria-hidden="true" />
      {status && status !== 'pending' && <span className="droplet-ring" data-status={status} aria-hidden="true" />}
    </span>
  );
}
