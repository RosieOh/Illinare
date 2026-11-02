import { createHash } from 'node:crypto';
import type { AgentId, MemoryItem, MissionTurn, Settings } from '@/lib/contracts';
import type { ToolAttachment } from '@/lib/tools/registry';
import type { ToolResultBlockParam } from './llm';

/** 데이터 안의 태그가 감싸는 태그를 닫거나 위조하지 못하게 무력화한다. */
export function neutralizeTags(text: string): string {
  return String(text).replace(/<(\/?)(tool_output|upstream_output|mission_goal|your_task|user_memory|earlier_turns)/gi, '&lt;$1$2');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function wrapToolOutput(tool: string, status: string, content: string): string {
  return `<tool_output tool="${escapeAttr(tool)}" status="${escapeAttr(status)}">\n${neutralizeTags(content)}\n</tool_output>`;
}

/** PDF, 이미지처럼 모델이 직접 읽을 첨부를 tool_result 본문에 붙인다. */
export function withAttachment(result: ToolResultBlockParam, attachment: ToolAttachment): ToolResultBlockParam {
  const text = typeof result.content === 'string' ? result.content : '';
  return {
    ...result,
    content: [
      { type: 'text', text },
      attachment.kind === 'pdf'
        ? {
            type: 'document',
            title: attachment.name,
            source: { type: 'base64', media_type: 'application/pdf', data: attachment.data },
          }
        : {
            type: 'image',
            source: { type: 'base64', media_type: attachment.mediaType, data: attachment.data },
          },
    ],
  };
}

export function wrapUpstream(agent: AgentId, stepId: string, text: string): string {
  return `<upstream_output agent="${agent}" step="${escapeAttr(stepId)}" trust="untrusted">\n${neutralizeTags(text)}\n</upstream_output>`;
}

/**
 * 첫 사용자 메시지 머리말. 날짜와 기억 항목은 바뀌는 값이라 시스템 프롬프트에 넣지 않는다.
 */
export function buildPreamble(settings: Pick<Settings, 'displayName'>, memory: MemoryItem[], now = new Date()): string {
  const date = now.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
  const time = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const lines = [`오늘: ${date} ${time} (${zone})`];
  if (settings.displayName) lines.push(`사용자 이름: ${neutralizeTags(settings.displayName)}`);
  if (memory.length > 0) {
    lines.push('<user_memory>', ...memory.map((m) => `- ${neutralizeTags(m.text)}`), '</user_memory>');
  }
  return lines.join('\n');
}

export function formatEarlierTurns(turns: MissionTurn[]): string {
  if (turns.length === 0) return '';
  const body = turns
    .map((t) => `사용자: ${neutralizeTags(t.goal)}\n답변: ${neutralizeTags(t.answer)}`)
    .join('\n\n');
  return `<earlier_turns>\n${body}\n</earlier_turns>`;
}

/**
 * 미션 기록에 그대로 남겨도 되는 입력 필드. 어디를 건드렸는지 알려주는 식별자만 둔다.
 * 나머지 글(쓰기 내용, 클립보드, 코드 등)은 새 도구를 포함해 기본적으로 길이와 해시만 남는다.
 * query와 url은 기기 밖으로 나간 값이라 사용자가 볼 수 있어야 한다.
 */
const RECORDED_FIELDS = new Set([
  'path',
  'query',
  'url',
  'name',
  'filename',
  'city',
  'timezone',
  'id',
  'from',
  'to',
  'date',
  'time',
  'due',
  'priority',
  'kind',
  'sound',
  'voice',
]);

/** 내용을 남기지 않고 같은 내용인지만 대조할 수 있게 한다. 쓴 파일의 sha256과 비교할 수 있다. */
function fingerprint(value: unknown): { bytes: number; sha256: string } {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  return { bytes: Buffer.byteLength(text, 'utf8'), sha256: createHash('sha256').update(text, 'utf8').digest('hex') };
}

/** 이벤트 로그와 스냅샷, 화면에 남길 입력. 모델이나 도구에 주는 값이 아니다. 로그는 추가만 하므로 처음부터 이 형태로 쓴다. */
export function recordedInput(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input !== 'object' || Array.isArray(input)) return fingerprint(input);
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (typeof value === 'string') return [key, RECORDED_FIELDS.has(key) ? compactInput(value) : fingerprint(value)];
      return [key, value !== null && typeof value === 'object' ? fingerprint(value) : value];
    })
  );
}

/** 이벤트에 담을 입력을 줄인다. 모델에게 주는 값이 아니라 화면과 저장용이다. */
export function compactInput(input: unknown, maxChars = 2000): unknown {
  if (typeof input === 'string') {
    return input.length > maxChars ? `${input.slice(0, maxChars)}…(${input.length}자)` : input;
  }
  if (Array.isArray(input)) return input.slice(0, 50).map((v) => compactInput(v, maxChars));
  if (input && typeof input === 'object') {
    return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, compactInput(v, maxChars)]));
  }
  return input;
}

export function compactResult(text: string, maxChars = 4000): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(잘림)` : text;
}
