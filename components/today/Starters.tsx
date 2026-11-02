'use client';

import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import type { AgentId } from '@/lib/contracts';
import { AgentAvatar, Material } from '@/components/glass';
import { useApp } from '@/context/AppContext';

interface Starter {
  title: string;
  /** 컴포저에 그대로 채우는 요청문. 무엇을 맡기면 되는지 이 문장이 보여준다. */
  goal: string;
  agents: AgentId[];
}

const STARTERS: Starter[] = [
  {
    title: '조사해서 보고서로 받기',
    goal: '국내 전자책 구독 서비스 3곳의 요금과 특징을 비교해서 한 페이지 보고서로 정리해 주세요.',
    agents: ['researcher', 'writer'],
  },
  {
    title: '내 파일 정리 계획 세우기',
    goal: '다운로드 폴더를 살펴보고 종류별 정리 계획을 세워 주세요. 파일은 옮기기 전에 먼저 보여 주세요.',
    agents: ['archivist'],
  },
  {
    title: '이번 주 일정 잡기',
    goal: '이번 주 금요일까지 분기 보고서 초안, 디자인 검토, 세금 계산서 발행을 끝내야 해요. 할 일 목록에 넣고 일정도 잡아 주세요.',
    agents: ['planner'],
  },
];

/** 첫날 화면. 빈 칸 대신 바로 맡길 수 있는 일 세 가지를 보여준다. 누르면 입력창에 채워지고, 보내기 전에 고칠 수 있다. */
export function Starters() {
  const { fillComposer } = useApp();
  return (
    <Material as="section" aria-labelledby="today-starters" className="flex h-full flex-col p-5 max-sm:p-4">
      <h2 id="today-starters" className="text-title2 text-label">
        이런 일을 맡겨 보세요
      </h2>
      <p className="mt-1 text-callout text-label-2">누르면 입력창에 채워져요. 내 상황에 맞게 고쳐서 보내면 돼요.</p>

      <ul className="mt-4 space-y-1.5">
        {STARTERS.map((starter) => (
          <li key={starter.title}>
            <button
              type="button"
              onClick={() => fillComposer(starter.goal)}
              className="press group flex w-full items-start gap-3.5 rounded-[16px] p-3 text-left hover:bg-fill-4"
            >
              <span className="flex shrink-0 -space-x-2 pt-0.5" aria-hidden="true">
                {starter.agents.map((agent) => (
                  <AgentAvatar key={agent} agent={agent} size="md" decorative />
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-headline text-label">{starter.title}</span>
                <span className="mt-0.5 block text-subhead text-label-2 break-keep">{starter.goal}</span>
              </span>
              <ArrowUpRight size={17} className="mt-1 shrink-0 text-label-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-auto flex items-center gap-1.5 pt-4 text-subhead text-label-2">
        <ShieldCheck size={14} className="shrink-0 text-success-text" aria-hidden="true" />
        컴퓨터를 바꾸는 작업은 실행 전에 먼저 물어봐요.
      </p>
    </Material>
  );
}
