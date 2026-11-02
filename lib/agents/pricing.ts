import type Anthropic from '@anthropic-ai/sdk';
import type { UsageTotals } from '@/lib/contracts';

/**
 * $/MTok. server-side fallback으로 다른 모델이 응답할 수 있어 그 모델들도 포함한다.
 * 출처: https://platform.claude.com/docs/en/about-claude/pricing (2026-11-02 확인)
 */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

/** 표에 없는 모델은 비용을 0으로 숨기지 않고 보수적으로 잡는다. */
const UNKNOWN_MODEL: Price = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

/** Haiku 5.5는 입력 10만 토큰을 넘으면 단가가 5배가 된다. */
const HAIKU_LONG_CONTEXT_TOKENS = 100_000;

/** 웹 검색은 1,000건당 $10. 웹 페이지 읽기는 토큰 비용만 든다. */
const WEB_SEARCH_USD = 0.01;

function priceFor(model: string, promptTokens: number): Price {
  // 긴 이름부터 비교해야 claude-opus-5-5가 claude-opus-5에 걸리지 않는다.
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model === k || model.startsWith(`${k}-`));
  const price = key ? PRICES[key] : UNKNOWN_MODEL;
  if (key === 'claude-haiku-5-5' && promptTokens > HAIKU_LONG_CONTEXT_TOKENS) {
    return {
      input: price.input * 5,
      output: price.output * 5,
      cacheRead: price.cacheRead * 5,
      cacheWrite: price.cacheWrite * 5,
    };
  }
  return price;
}

/** 출력 토큰 한 개의 값. 호출의 max_tokens를 남은 예산에 맞출 때 쓴다. */
export function outputUsdPerToken(model: string): number {
  return priceFor(model, 0).output / 1_000_000;
}

/**
 * 호출 전 입력 비용 추정. 프롬프트 캐시를 켜 두므로 이미 보낸 앞부분은 캐시 읽기 단가로,
 * 새로 붙은 뒷부분은 캐시 쓰기 단가로 잡는다. 캐시가 빗나가면 message_start에서 실제 값으로 바로잡힌다.
 */
export function estimateInputUsd(model: string, freshTokens: number, cachedTokens: number): number {
  const p = priceFor(model, freshTokens + cachedTokens);
  return (freshTokens * p.cacheWrite + cachedTokens * p.cacheRead) / 1_000_000;
}

interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

function tokenCost(model: string, u: TokenCounts): number {
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const p = priceFor(model, u.input_tokens + cacheRead + cacheWrite);
  return (
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      cacheRead * p.cacheRead +
      cacheWrite * p.cacheWrite) /
    1_000_000
  );
}

function totals(usage: TokenCounts, costUsd: number): UsageTotals {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    costUsd,
  };
}

function webSearchCost(usage: Anthropic.Beta.BetaUsage): number {
  return (usage.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD;
}

export function costOf(model: string, usage: Anthropic.Beta.BetaUsage): UsageTotals {
  // 거절 후 다른 모델이 이어 받으면 iteration마다 모델이 다르므로 나눠서 계산한다.
  const tokens = usage.iterations?.some((i) => i.type === 'fallback_message')
    ? usage.iterations.reduce((sum, i) => {
        if (i.type === 'fallback_message') return sum + tokenCost(i.model, i);
        if (i.type === 'message') return sum + tokenCost(i.model ?? model, i);
        return sum;
      }, 0)
    : tokenCost(model, usage);
  return totals(usage, tokens + webSearchCost(usage));
}

/** 출력이 나오기 전의 거절 중 이 분류만 청구된다 (refusals-and-fallback, How refusals are billed). */
const BILLED_BEFORE_OUTPUT: readonly (string | null | undefined)[] = ['bio', 'frontier_llm', 'reasoning_extraction'];

type BilledMessage = Pick<Anthropic.Beta.BetaMessage, 'model' | 'usage' | 'content' | 'stop_reason' | 'stop_details'>;

/**
 * 응답 한 건의 실제 청구액. 토큰 수는 usage에 그대로 보고되지만 출력 전 거절은 대부분 청구되지 않는다.
 * fallback이 있으면 시도마다 판단한다: fallback 블록 사이가 비어 있는 시도는 출력 전에 거절된 것이다.
 */
export function costOfMessage(message: BilledMessage): UsageTotals {
  const { model, usage, content, stop_reason: stop } = message;
  const finalCategory = stop === 'refusal' ? message.stop_details?.category : undefined;

  if (!usage.iterations?.some((i) => i.type === 'fallback_message')) {
    const declinedBeforeOutput = stop === 'refusal' && content.length === 0;
    if (declinedBeforeOutput && !BILLED_BEFORE_OUTPUT.includes(finalCategory)) return totals(usage, 0);
    return costOf(model, usage);
  }

  const attempts = usage.iterations.filter((i) => i.type === 'message' || i.type === 'fallback_message');
  const handoffs: { category: string | null; hadOutput: boolean }[] = [];
  let hadOutput = false;
  for (const block of content) {
    if (block.type === 'fallback') {
      handoffs.push({ category: block.trigger.category, hadOutput });
      hadOutput = false;
    } else {
      hadOutput = true;
    }
  }
  // 시도 수와 경계 수가 맞지 않으면 판단할 수 없으므로 모두 청구된 것으로 친다.
  if (attempts.length !== handoffs.length + 1) return costOf(model, usage);

  let cost = webSearchCost(usage);
  const sum: TokenCounts = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  attempts.forEach((attempt, index) => {
    const handoff = handoffs[index];
    const declinedBeforeOutput = handoff ? !handoff.hadOutput : stop === 'refusal' && !hadOutput;
    const category = handoff ? handoff.category : finalCategory;
    if (declinedBeforeOutput && !BILLED_BEFORE_OUTPUT.includes(category)) return;
    cost += tokenCost(attempt.model ?? model, attempt);
    sum.input_tokens += attempt.input_tokens;
    sum.output_tokens += attempt.output_tokens;
    sum.cache_read_input_tokens = (sum.cache_read_input_tokens ?? 0) + (attempt.cache_read_input_tokens ?? 0);
    sum.cache_creation_input_tokens = (sum.cache_creation_input_tokens ?? 0) + (attempt.cache_creation_input_tokens ?? 0);
  });
  return totals(sum, cost);
}
