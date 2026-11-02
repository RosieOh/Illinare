import type {
  ApprovalDecision,
  ApprovalPreview,
  ApprovalRequest,
  MissionEventBody,
  MissionPlan,
  PlanStep,
  ToolRisk,
} from '@/lib/contracts';
import { newId } from '@/lib/store/json';
import { CancelledError } from './errors';

/**
 * 데모 모드. API 키가 없을 때 실제 미션과 똑같은 이벤트 흐름을 재생한다.
 * 이 파일은 도구를 import 하지 않는다: 파일, 앱, 네트워크 어느 것도 건드리지 않고,
 * 도구 호출과 결과는 전부 지어낸 예시다. 모든 답변이 데모임을 밝힌다.
 */
export interface DemoEnv {
  emit: (body: MissionEventBody) => void;
  signal: AbortSignal;
  askApproval: (approval: ApprovalRequest) => Promise<ApprovalDecision>;
}

const DEMO_NOTICE = '\n\n---\n\n이 결과는 **데모**예요. 내용은 모두 지어낸 예시이고, 실제 AI 호출 없이 재생했어요. 내 컴퓨터의 파일이나 설정은 바뀌지 않았어요. 설정에서 Anthropic API 키를 등록하면 같은 요청을 실제로 처리해요.';

function speed(): number {
  const value = Number(process.env.ILLIONAIRE_DEMO_SPEED);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms / speed());
    function onAbort() {
      clearTimeout(timer);
      reject(new CancelledError());
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** 한글 몇 글자씩 끊어 실제 토큰 스트림처럼 흘려보낸다. */
async function typeOut(text: string, send: (delta: string) => void, signal: AbortSignal, msPerChunk = 28) {
  const chunkSize = 5;
  for (let i = 0; i < text.length; i += chunkSize) {
    send(text.slice(i, i + chunkSize));
    await sleep(msPerChunk, signal);
  }
}

type DemoAction =
  | { kind: 'think'; text: string }
  | { kind: 'text'; text: string }
  | {
      kind: 'tool';
      name: string;
      summary: string;
      input: unknown;
      risk?: ToolRisk;
      serverSide?: boolean;
      /** 외부 데이터를 읽는 호출이면 단계가 오염 상태가 된다 */
      untrusted?: boolean;
      result: string;
      ms: number;
    }
  | {
      kind: 'approval';
      name: string;
      summary: string;
      input: unknown;
      risk: ToolRisk;
      reason: string;
      preview?: ApprovalPreview;
      approvedResult: string;
      deniedText: string;
    };

interface DemoStep extends PlanStep {
  actions: DemoAction[];
  output: string;
}

interface DemoScript {
  title: string;
  rationale: string;
  thinking: string;
  steps: DemoStep[];
  answer: string;
  /** 승인을 거부했을 때 답변 앞에 덧붙이는 문장 */
  deniedNote: string;
}

const RESEARCH: DemoScript = {
  title: '가격 조사 보고서',
  rationale: '자료를 나란히 모은 뒤 숫자를 정리하고 보고서로 묶어요.',
  thinking:
    '목표는 경쟁 제품 가격을 비교한 보고서예요. 웹 조사는 두 갈래로 나눠 동시에 진행하면 빨라요. 조사가 끝나야 숫자를 정리할 수 있고, 정리된 뒤에 글을 쓰면 돼요. 저장은 파일을 만드는 일이니 승인을 받아야 해요.',
  steps: [
    {
      id: 's1',
      agent: 'researcher',
      title: '시장 자료 찾기',
      task: '시장 규모와 가격대 자료를 찾아 출처와 함께 정리해 주세요.',
      dependsOn: [],
      actions: [
        { kind: 'think', text: '공식 자료를 먼저 찾고, 수치는 두 곳 이상에서 맞춰 볼게요.' },
        { kind: 'tool', name: 'web_search', summary: '웹 검색: 업무용 AI 도구 시장 규모', input: { query: '업무용 AI 도구 시장 규모' }, serverSide: true, untrusted: true, result: '예시 리포트 A — https://example.com/report-a\n예시 리포트 B — https://example.com/report-b', ms: 1400 },
        { kind: 'tool', name: 'web_fetch', summary: '웹 페이지 읽기: example.com/report-a', input: { url: 'https://example.com/report-a' }, serverSide: true, untrusted: true, result: 'https://example.com/report-a', ms: 1100 },
        { kind: 'text', text: '예시 리포트 두 곳에서 시장 규모와 가격대를 확인했어요.' },
      ],
      output: '[예시 데이터] 개인 요금제는 월 $20 안팎에 몰려 있어요. 출처: https://example.com/report-a, https://example.com/report-b',
    },
    {
      id: 's2',
      agent: 'researcher',
      title: '경쟁 제품 가격 수집',
      task: '경쟁 제품 세 곳의 요금제를 찾아 표로 정리해 주세요.',
      dependsOn: [],
      actions: [
        { kind: 'think', text: '각 제품의 공식 요금 페이지를 직접 볼게요.' },
        { kind: 'tool', name: 'web_search', summary: '웹 검색: 예시 제품 요금제 비교', input: { query: '예시 제품 요금제 비교' }, serverSide: true, untrusted: true, result: '제품 A 요금 — https://example.com/a/pricing\n제품 B 요금 — https://example.com/b/pricing\n제품 C 요금 — https://example.com/c/pricing', ms: 1700 },
        { kind: 'tool', name: 'web_fetch', summary: '웹 페이지 읽기: example.com/a/pricing', input: { url: 'https://example.com/a/pricing' }, serverSide: true, untrusted: true, result: 'https://example.com/a/pricing', ms: 900 },
        { kind: 'tool', name: 'web_fetch', summary: '웹 페이지 읽기: example.com/b/pricing', input: { url: 'https://example.com/b/pricing' }, serverSide: true, untrusted: true, result: 'https://example.com/b/pricing', ms: 800 },
        { kind: 'text', text: '세 제품의 요금제를 모았어요.' },
      ],
      output: '[예시 데이터] 제품 A 월 $20, 제품 B 월 $25, 제품 C 월 $16. 모두 지어낸 값이에요.',
    },
    {
      id: 's3',
      agent: 'analyst',
      title: '숫자 정리',
      task: '모은 가격의 평균과 차이를 계산해 주세요.',
      dependsOn: ['s1', 's2'],
      actions: [
        { kind: 'think', text: '샌드박스에서 평균을 직접 계산할게요.' },
        { kind: 'tool', name: 'code_execution', summary: '샌드박스 코드 실행', input: { code: 'print(sum([20, 25, 16]) / 3)' }, serverSide: true, result: '20.33', ms: 1200 },
        { kind: 'text', text: '세 제품 평균은 월 $20.33이에요.' },
      ],
      output: '[예시 데이터] 평균 월 $20.33, 최저 제품 C, 최고 제품 B. 최고와 최저의 차이는 $9예요.',
    },
    {
      id: 's4',
      agent: 'writer',
      title: '보고서 작성',
      task: '조사 내용을 한 페이지 보고서로 쓰고 메모로 저장해 주세요.',
      dependsOn: ['s3'],
      actions: [
        { kind: 'think', text: '결론을 먼저 쓰고 근거를 표로 붙일게요. 숫자는 받은 그대로 옮겨요.' },
        { kind: 'text', text: '보고서 초안을 작성했어요. 저장하려면 승인이 필요해요.' },
        {
          kind: 'approval',
          name: 'save_note',
          summary: '메모 저장: 가격 조사 보고서.md',
          input: { name: '가격 조사 보고서' },
          risk: 'confirm',
          reason: '새 파일을 만들어요.',
          preview: {
            kind: 'text',
            path: '데모: 실제로 저장되지 않아요',
            text: '# 가격 조사 보고서\n\n세 제품의 평균 가격은 월 $20.33이에요. (예시 데이터)',
          },
          approvedResult: '(데모) 저장한 것처럼 표시만 했어요. 실제 파일은 만들지 않았어요.',
          deniedText: '저장은 거부되어 건너뛰었어요.',
        },
      ],
      output: '[예시 데이터] 보고서를 작성했어요.',
    },
  ],
  answer: `## 가격 조사 결과

세 제품의 평균 가격은 **월 $20.33**이에요. 제품 C가 가장 저렴하고, 제품 B가 가장 비싸요.

| 제품 | 월 요금 | 평균 대비 |
| --- | --- | --- |
| 제품 A | $20 | -$0.33 |
| 제품 B | $25 | +$4.67 |
| 제품 C | $16 | -$4.33 |

출처: https://example.com/report-a, https://example.com/a/pricing`,
  deniedNote: '보고서 저장을 거부해서 파일로 남기지 않았어요.\n\n',
};

const FILES: DemoScript = {
  title: '다운로드 폴더 정리',
  rationale: '먼저 살펴보고, 삭제는 승인을 받은 뒤에만 진행해요.',
  thinking:
    '폴더 내용을 먼저 봐야 어떻게 나눌지 정할 수 있어요. 파일 목록을 보는 일과 오래된 파일을 찾는 일은 동시에 할 수 있어요. 삭제는 되돌리기 어려우니 반드시 물어봐야 해요.',
  steps: [
    {
      id: 's1',
      agent: 'archivist',
      title: '폴더 살펴보기',
      task: '다운로드 폴더의 파일을 종류별로 세어 주세요.',
      dependsOn: [],
      actions: [
        { kind: 'tool', name: 'list_files', summary: '디렉터리 조회: ~/Downloads', input: { path: '~/Downloads' }, untrusted: true, result: '(데모) 예시 파일 128개: 문서 41, 이미지 52, 설치 파일 19, 기타 16', ms: 900 },
        { kind: 'text', text: '예시 폴더에 파일 128개가 있어요.' },
      ],
      output: '[예시 데이터] 파일 128개: 문서 41, 이미지 52, 설치 파일 19, 기타 16',
    },
    {
      id: 's2',
      agent: 'archivist',
      title: '중복 파일 찾기',
      task: '이름과 크기가 같은 중복 파일을 찾아 주세요.',
      dependsOn: [],
      actions: [
        { kind: 'tool', name: 'search_files', summary: '중복 파일 검색: ~/Downloads', input: { path: '~/Downloads' }, untrusted: true, result: '(데모) 중복으로 보이는 설치 파일 3개, 합계 1.2GB', ms: 1500 },
        { kind: 'text', text: '중복으로 보이는 파일 3개를 찾았어요.' },
      ],
      output: '[예시 데이터] 중복 설치 파일 3개, 합계 1.2GB',
    },
    {
      id: 's3',
      agent: 'archivist',
      title: '중복 파일 지우기',
      task: '찾은 중복 파일을 휴지통으로 옮겨 주세요.',
      dependsOn: ['s1', 's2'],
      actions: [
        { kind: 'think', text: '삭제는 위험 등급이라 먼저 물어볼게요. 승인해도 휴지통으로만 옮겨요.' },
        {
          kind: 'approval',
          name: 'delete_file',
          summary: '파일 3개를 휴지통으로 이동 (1.2GB)',
          input: { paths: ['~/Downloads/setup (1).exe', '~/Downloads/setup (2).exe', '~/Downloads/setup (3).exe'] },
          risk: 'danger',
          reason: '파일을 지우는 작업이에요. 항상 먼저 확인해요.',
          preview: {
            kind: 'text',
            path: '데모: 실제로 지워지지 않아요',
            text: '~/Downloads/setup (1).exe\n~/Downloads/setup (2).exe\n~/Downloads/setup (3).exe',
          },
          approvedResult: '(데모) 지운 것처럼 표시만 했어요. 실제 파일은 그대로예요.',
          deniedText: '삭제는 거부되어 건너뛰었어요.',
        },
      ],
      output: '[예시 데이터] 중복 파일 처리를 마쳤어요.',
    },
  ],
  answer: `## 다운로드 폴더 정리

파일 **128개**를 살펴봤고, 중복으로 보이는 설치 파일 3개(1.2GB)를 처리했어요.

- 문서 41개
- 이미지 52개
- 설치 파일 19개
- 기타 16개`,
  deniedNote: '삭제를 거부해서 중복 파일은 그대로 뒀어요.\n\n',
};

const WEEK: DemoScript = {
  title: '이번 주 계획',
  rationale: '기존 일정을 읽고, 집중 시간과 브리핑을 나눠서 준비해요.',
  thinking:
    '기존 일정을 먼저 읽어야 겹치지 않게 잡을 수 있어요. 그 다음 일정 추가와 브리핑 작성은 서로 기다릴 필요가 없어요. 일정을 추가하는 일은 승인을 받아요.',
  steps: [
    {
      id: 's1',
      agent: 'planner',
      title: '일정과 할 일 읽기',
      task: '이번 주 일정과 남은 할 일을 읽어 주세요.',
      dependsOn: [],
      actions: [
        { kind: 'tool', name: 'list_events', summary: '이번 주 일정 조회', input: { range: 'this_week' }, result: '(데모) 예시 회의 4건', ms: 700 },
        { kind: 'tool', name: 'list_tasks', summary: '남은 할 일 조회', input: {}, result: '(데모) 예시 할 일 6건, 이 중 2건은 마감 임박', ms: 600 },
        { kind: 'text', text: '회의 4건과 할 일 6건을 확인했어요.' },
      ],
      output: '[예시 데이터] 회의 4건, 할 일 6건(마감 임박 2건). 화요일과 목요일 오전이 비어 있어요.',
    },
    {
      id: 's2',
      agent: 'planner',
      title: '집중 시간 잡기',
      task: '비어 있는 오전에 집중 시간을 추가해 주세요.',
      dependsOn: ['s1'],
      actions: [
        {
          kind: 'approval',
          name: 'add_event',
          summary: '일정 추가: 집중 시간 (화, 목 오전 9시~11시)',
          input: { title: '집중 시간' },
          risk: 'confirm',
          reason: '캘린더에 일정을 추가해요.',
          approvedResult: '(데모) 추가한 것처럼 표시만 했어요. 실제 일정은 바뀌지 않았어요.',
          deniedText: '일정 추가는 거부되어 건너뛰었어요.',
        },
      ],
      output: '[예시 데이터] 화요일과 목요일 오전에 집중 시간을 잡았어요.',
    },
    {
      id: 's3',
      agent: 'writer',
      title: '주간 브리핑 쓰기',
      task: '이번 주에 먼저 할 일을 짧은 브리핑으로 정리해 주세요.',
      dependsOn: ['s1'],
      actions: [
        { kind: 'think', text: '마감이 가까운 일부터 앞에 둘게요.' },
        { kind: 'text', text: '브리핑을 작성했어요.' },
      ],
      output: '[예시 데이터] 마감 임박 2건을 화요일 집중 시간에 처리하는 것을 추천해요.',
    },
  ],
  answer: `## 이번 주 계획

**먼저 할 일:** 마감이 가까운 2건을 화요일 오전 집중 시간에 처리하세요.

- **화요일 오전:** 집중 시간
- **수요일:** 회의 2건
- **목요일 오전:** 집중 시간, 남은 할 일 정리
- **금요일:** 회의 2건`,
  deniedNote: '일정 추가를 거부해서 집중 시간은 캘린더에 넣지 않았어요.\n\n',
};

function pickScript(goal: string): DemoScript | null {
  if (/조사|리서치|보고서|경쟁|시장|가격|research|report/i.test(goal)) return RESEARCH;
  if (/파일|폴더|다운로드|중복|file|folder/i.test(goal)) return FILES;
  if (/일정|계획|이번\s*주|주간|할\s*일|플랜|schedule|plan|week/i.test(goal)) return WEEK;
  return null;
}

async function runDemoStep(step: DemoStep, tainted: boolean, env: DemoEnv): Promise<{ tainted: boolean; denied: boolean }> {
  const { emit, signal } = env;
  let isTainted = tainted;
  let denied = false;
  emit({ type: 'step.started', stepId: step.id });
  if (isTainted) emit({ type: 'step.tainted', stepId: step.id });
  emit({ type: 'usage', stepId: step.id, model: 'demo', delta: zeroUsage() });
  await sleep(350, signal);

  for (const action of step.actions) {
    if (action.kind === 'think') {
      await typeOut(action.text, (delta) => emit({ type: 'step.thinking', stepId: step.id, delta }), signal, 24);
    } else if (action.kind === 'text') {
      await typeOut(action.text, (delta) => emit({ type: 'step.text', stepId: step.id, delta }), signal);
    } else if (action.kind === 'tool') {
      const callId = newId('demo');
      emit({
        type: 'tool.started',
        call: {
          callId,
          stepId: step.id,
          agent: step.agent,
          name: action.name,
          summary: action.summary,
          input: action.input,
          risk: action.risk ?? 'safe',
          serverSide: action.serverSide,
          status: 'running',
          startedAt: Date.now(),
        },
      });
      await sleep(action.ms, signal);
      emit({ type: 'tool.finished', stepId: step.id, callId, status: 'ok', result: action.result });
      if (action.untrusted && !isTainted) {
        isTainted = true;
        emit({ type: 'step.tainted', stepId: step.id });
      }
    } else {
      const callId = newId('demo');
      emit({
        type: 'tool.started',
        call: {
          callId,
          stepId: step.id,
          agent: step.agent,
          name: action.name,
          summary: action.summary,
          input: action.input,
          risk: action.risk,
          status: 'running',
          startedAt: Date.now(),
        },
      });
      const decision = await env.askApproval({
        id: newId('ap'),
        kind: 'tool',
        stepId: step.id,
        agent: step.agent,
        callId,
        tool: action.name,
        summary: action.summary,
        risk: action.risk,
        reason: action.reason,
        preview: action.preview,
        tainted: isTainted || undefined,
        requestedAt: Date.now(),
      });
      if (decision === 'approve') {
        await sleep(500, signal);
        emit({ type: 'tool.finished', stepId: step.id, callId, status: 'ok', result: action.approvedResult });
      } else {
        denied = true;
        emit({ type: 'tool.finished', stepId: step.id, callId, status: 'denied', result: action.deniedText });
      }
    }
  }
  await sleep(200, signal);
  emit({ type: 'step.finished', stepId: step.id, status: 'done', output: denied ? `${step.output} (일부 작업은 거부됨)` : step.output });
  return { tainted: isTainted, denied };
}

function zeroUsage() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
}

export async function runDemo(goal: string, env: DemoEnv): Promise<void> {
  const { emit, signal } = env;
  const script = pickScript(goal);

  if (!script) {
    const plan: MissionPlan = {
      title: goal.slice(0, 24),
      route: 'answer',
      steps: [],
      rationale: '도구 없이 바로 답할 수 있어요.',
    };
    await typeOut('간단한 요청이라 팀을 나누지 않고 바로 답할게요.', (delta) => emit({ type: 'conductor.thinking', delta }), signal, 24);
    await sleep(300, signal);
    emit({ type: 'plan.ready', plan });
    emit({ type: 'mission.status', status: 'synthesizing' });
    const text = `지금은 **데모 모드**라 이 요청에 실제로 답하지는 못해요. 요청하신 내용은 "${goal.slice(0, 80)}"로 받았어요.

API 키를 등록하면 지휘자가 이 목표를 읽고, 필요하면 전문 에이전트들에게 나눠서 처리해요. 데모에서는 이런 요청으로 팀이 일하는 모습을 볼 수 있어요.

- 경쟁 제품 가격을 조사해서 보고서로 써줘
- 다운로드 폴더를 정리해줘
- 이번 주 계획을 세워줘${DEMO_NOTICE}`;
    await typeOut(text, (delta) => emit({ type: 'answer.delta', delta }), signal);
    emit({ type: 'answer.done', text });
    return;
  }

  await typeOut(script.thinking, (delta) => emit({ type: 'conductor.thinking', delta }), signal, 22);
  await sleep(350, signal);
  const plan: MissionPlan = {
    title: script.title,
    route: 'team',
    rationale: script.rationale,
    steps: script.steps.map(({ id, agent, title, task, dependsOn }) => ({ id, agent, title, task, dependsOn })),
  };
  emit({ type: 'plan.ready', plan });
  emit({ type: 'mission.status', status: 'running' });

  const results = new Map<string, Promise<{ tainted: boolean; denied: boolean }>>();
  const runInOrder = (step: DemoStep): Promise<{ tainted: boolean; denied: boolean }> => {
    const existing = results.get(step.id);
    if (existing) return existing;
    const promise = (async () => {
      const deps = await Promise.all(
        step.dependsOn.map((id) => runInOrder(script.steps.find((s) => s.id === id) as DemoStep))
      );
      return runDemoStep(step, deps.some((d) => d.tainted), env);
    })();
    results.set(step.id, promise);
    return promise;
  };
  const outcomes = await Promise.all(script.steps.map(runInOrder));
  const anyDenied = outcomes.some((o) => o.denied);

  emit({ type: 'mission.status', status: 'synthesizing' });
  await sleep(400, signal);
  const text = `${anyDenied ? script.deniedNote : ''}${script.answer}${DEMO_NOTICE}`;
  await typeOut(text, (delta) => emit({ type: 'answer.delta', delta }), signal);
  emit({ type: 'answer.done', text });
}
