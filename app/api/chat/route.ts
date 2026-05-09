import Anthropic from '@anthropic-ai/sdk';
import { asAnthropicTools, getTool, type ToolRisk } from '@/lib/tools';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `당신은 일리네어(ILLIONAIRE)입니다. 사용자를 "보스"라고 부르는 macOS AI 어시스턴트입니다.

응답 스타일:
- 항상 한국어, 격식체(~습니다, ~입니다)
- 간결하게 1~3문장
- 약간 기술적이고 절제된 어조

도구 사용 규칙:
- 사용자 요청을 수행하기 위해 적절한 도구(tool)를 사용하세요. 가능하면 도구로 직접 처리합니다.
- "위험" 또는 "변경" 도구는 사용자가 승인해야만 실행됩니다. 거부되면 자연스럽게 다른 방안을 제안하세요.
- 도구 결과를 받은 뒤에는 보스에게 한 줄로 결과를 보고하세요. 원본 출력을 그대로 붙여넣지 말고 요약하세요.
- 사용자가 명시적으로 요청하지 않은 변경 작업은 먼저 의도를 확인하세요.`;

const MAX_ITERATIONS = 8;

type Message = Anthropic.Messages.MessageParam;
type ToolUseBlock = Extract<Anthropic.Messages.ContentBlock, { type: 'tool_use' }>;
type TextBlock = Extract<Anthropic.Messages.ContentBlock, { type: 'text' }>;

interface PendingTool {
  id: string;
  name: string;
  input: unknown;
  summary: string;
  risk: ToolRisk;
}

interface ToolCallLog {
  id: string;
  name: string;
  input: unknown;
  risk: ToolRisk;
  status: 'ok' | 'error' | 'denied';
  result: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      messages: Message[];
      decisions?: Record<string, 'approve' | 'deny'>;
      partialResults?: Record<string, string>;
    };

    let messages: Message[] = body.messages;
    let decisions = body.decisions ?? {};
    let partialResults = body.partialResults ?? {};
    const log: ToolCallLog[] = [];

    // Resume case: 마지막 assistant 턴이 tool_use를 포함하면, tool_result user 턴을
    // partialResults + decisions 로 구성해서 먼저 push 한 뒤 Claude 호출
    const lastAssistant = findLastAssistant(messages);
    if (lastAssistant && hasToolUse(lastAssistant)) {
      const userTurn = await buildResumeUserTurn(
        lastAssistant,
        decisions,
        partialResults,
        log
      );
      const pending = collectPending(lastAssistant, decisions, partialResults);
      if (pending.length > 0) {
        // 일부 도구가 아직 미결정 — 그대로 다시 pending 반환
        return Response.json({
          done: false,
          pending,
          partialResults,
          assistantText: extractText(lastAssistant),
          messages,
          toolCalls: log,
        });
      }
      messages = [...messages, userTurn];
      // 사용한 결정은 폐기
      decisions = {};
      partialResults = {};
    }

    // Main loop
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: asAnthropicTools() as Anthropic.Messages.Tool[],
        messages,
      });

      // assistant 턴 추가
      const assistantTurn: Message = {
        role: 'assistant',
        content: response.content,
      };
      messages = [...messages, assistantTurn];

      if (response.stop_reason !== 'tool_use') {
        return Response.json({
          done: true,
          text: extractTextBlocks(response.content),
          messages,
          toolCalls: log,
        });
      }

      // 도구 처리
      const toolUses = response.content.filter(
        (b): b is ToolUseBlock => b.type === 'tool_use'
      );

      const safeResults: Record<string, string> = {};
      const pending: PendingTool[] = [];

      for (const use of toolUses) {
        const tool = getTool(use.name);
        if (!tool) {
          safeResults[use.id] = `알 수 없는 도구: ${use.name}`;
          log.push({
            id: use.id,
            name: use.name,
            input: use.input,
            risk: 'safe',
            status: 'error',
            result: safeResults[use.id],
          });
          continue;
        }

        if (tool.risk === 'safe') {
          try {
            const result = await tool.run(use.input);
            safeResults[use.id] = result;
            log.push({
              id: use.id,
              name: use.name,
              input: use.input,
              risk: tool.risk,
              status: 'ok',
              result,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            safeResults[use.id] = `오류: ${msg}`;
            log.push({
              id: use.id,
              name: use.name,
              input: use.input,
              risk: tool.risk,
              status: 'error',
              result: msg,
            });
          }
        } else {
          // confirm / danger — 승인 대기
          pending.push({
            id: use.id,
            name: use.name,
            input: use.input,
            summary: tool.summarize(use.input),
            risk: tool.risk,
          });
        }
      }

      if (pending.length > 0) {
        // 일시 정지 — 클라이언트 승인 대기
        return Response.json({
          done: false,
          pending,
          partialResults: safeResults,
          assistantText: extractTextBlocks(response.content),
          messages,
          toolCalls: log,
        });
      }

      // 모두 safe — 다음 user 턴 구성하고 루프 계속
      const toolResultBlocks: Anthropic.Messages.ToolResultBlockParam[] =
        toolUses.map((u) => ({
          type: 'tool_result' as const,
          tool_use_id: u.id,
          content: safeResults[u.id] ?? '',
          is_error: log.find((l) => l.id === u.id)?.status === 'error',
        }));

      messages = [
        ...messages,
        { role: 'user', content: toolResultBlocks },
      ];
    }

    return Response.json({
      done: true,
      text: '도구 호출이 너무 많아 중단되었습니다.',
      messages,
      toolCalls: log,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('chat route error:', err);
    return Response.json({ done: true, text: `서버 오류: ${msg}`, messages: [], toolCalls: [] }, { status: 500 });
  }
}

// ─── helpers ────────────────────────────────────────────────
function findLastAssistant(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i];
  }
  return undefined;
}

function hasToolUse(msg: Message): boolean {
  if (typeof msg.content === 'string') return false;
  return msg.content.some((b) => b.type === 'tool_use');
}

function extractText(msg: Message): string {
  if (typeof msg.content === 'string') return msg.content;
  return msg.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function extractTextBlocks(blocks: Anthropic.Messages.ContentBlock[]): string {
  return blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function collectPending(
  assistantMsg: Message,
  decisions: Record<string, 'approve' | 'deny'>,
  partialResults: Record<string, string>
): PendingTool[] {
  if (typeof assistantMsg.content === 'string') return [];
  const out: PendingTool[] = [];
  for (const b of assistantMsg.content) {
    if (b.type !== 'tool_use') continue;
    if (decisions[b.id] || partialResults[b.id]) continue;
    const tool = getTool(b.name);
    if (!tool) continue;
    if (tool.risk === 'safe') continue;
    out.push({
      id: b.id,
      name: b.name,
      input: b.input,
      summary: tool.summarize(b.input),
      risk: tool.risk,
    });
  }
  return out;
}

async function buildResumeUserTurn(
  assistantMsg: Message,
  decisions: Record<string, 'approve' | 'deny'>,
  partialResults: Record<string, string>,
  log: ToolCallLog[]
): Promise<Message> {
  if (typeof assistantMsg.content === 'string') {
    return { role: 'user', content: [] };
  }

  const blocks: Anthropic.Messages.ToolResultBlockParam[] = [];

  for (const b of assistantMsg.content) {
    if (b.type !== 'tool_use') continue;

    // 1) 이미 safe로 실행된 결과
    if (b.id in partialResults) {
      blocks.push({
        type: 'tool_result',
        tool_use_id: b.id,
        content: partialResults[b.id],
      });
      continue;
    }

    const decision = decisions[b.id];
    const tool = getTool(b.name);

    if (!tool) {
      blocks.push({
        type: 'tool_result',
        tool_use_id: b.id,
        content: `알 수 없는 도구: ${b.name}`,
        is_error: true,
      });
      continue;
    }

    if (decision === 'deny') {
      blocks.push({
        type: 'tool_result',
        tool_use_id: b.id,
        content: '사용자가 이 작업을 거부했습니다. 다른 방법을 제안해주세요.',
        is_error: true,
      });
      log.push({
        id: b.id,
        name: b.name,
        input: b.input,
        risk: tool.risk,
        status: 'denied',
        result: '거부됨',
      });
      continue;
    }

    if (decision === 'approve') {
      try {
        const result = await tool.run(b.input);
        blocks.push({
          type: 'tool_result',
          tool_use_id: b.id,
          content: result,
        });
        log.push({
          id: b.id,
          name: b.name,
          input: b.input,
          risk: tool.risk,
          status: 'ok',
          result,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        blocks.push({
          type: 'tool_result',
          tool_use_id: b.id,
          content: `오류: ${msg}`,
          is_error: true,
        });
        log.push({
          id: b.id,
          name: b.name,
          input: b.input,
          risk: tool.risk,
          status: 'error',
          result: msg,
        });
      }
      continue;
    }

    // 결정 안 된 경우는 호출자가 collectPending으로 잡아냄.
    // 여기서는 fallback으로 기본 거부.
    blocks.push({
      type: 'tool_result',
      tool_use_id: b.id,
      content: '결정되지 않았습니다',
      is_error: true,
    });
  }

  return { role: 'user', content: blocks };
}

