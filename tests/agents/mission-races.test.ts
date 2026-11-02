import { existsSync, promises as fs, readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissionPlan } from '@/lib/contracts';
import { setClientFactory, type LlmClient, type LlmStream, type StreamEvent } from '@/lib/agents/llm';
import { cancelOrDeleteMission, createMission, followupMission, getMissionView, listMissionSummaries, purgeAllMissions, resetMissionRegistryForTests, waitForMission } from '@/lib/agents/mission';
import { CONDUCTOR_PLAN_SYSTEM } from '@/lib/agents/roster';
import { dataPath, writeJson } from '@/lib/store/json';
import { patchSettings } from '@/lib/store/settings';
import { deleteAllData } from '@/lib/store/transfer';
import '@/lib/tools';
import { register } from '@/lib/tools/registry';
import { deferred, FakeClient, makeMessage, textBlock, toolUseBlock, waitUntil } from './helpers';

vi.mock('@/lib/store/secrets', () => ({ getApiKey: async () => 'sk-test', clearApiKey: async () => undefined }));

const ANSWER_PLAN: MissionPlan = { title: 't', route: 'answer', steps: [] };

beforeEach(async () => {
  await patchSettings({ budgetUsd: 2, reviewPlans: false, toolPolicies: {} });
  await writeJson(dataPath('memory.json'), []);
  resetMissionRegistryForTests();
});

describe('follow-ups arriving together', () => {
  it('starts one run and refuses the other, so nothing runs outside the cap', async () => {
    const hold = deferred();
    const signals: AbortSignal[] = [];
    const fake = new FakeClient(async (request) => {
      if (request.system === CONDUCTOR_PLAN_SYSTEM) return { message: makeMessage([textBlock(JSON.stringify(ANSWER_PLAN))]) };
      if (fake.requests.length > 2) await hold.promise;
      return { message: makeMessage([textBlock('답변')]) };
    });
    const client: LlmClient = {
      stream(request, signal) {
        signals.push(signal);
        return fake.stream(request, signal);
      },
    };
    setClientFactory(() => client);
    const id = await createMission('첫 질문');
    await waitForMission(id);
    const before = signals.length;

    for (let round = 0; round < 3; round++) {
      const results = await Promise.allSettled([followupMission(id, 'A'), followupMission(id, 'B')]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(String(refused.reason?.message)).toContain('진행 중');
      await cancelOrDeleteMission(id);
      await waitForMission(id);
    }
    hold.resolve();
    await new Promise((r) => setTimeout(r, 20));
    // 멈추기를 누르면 시작된 모든 호출이 끊겨야 한다.
    expect(signals.slice(before).every((s) => s.aborted)).toBe(true);
  });
});

describe('a cancelled call', () => {
  it('still records what it cost', async () => {
    const planClient = new FakeClient(() => ({ message: makeMessage([textBlock(JSON.stringify(ANSWER_PLAN))]) }));
    let started = 0;
    const client: LlmClient = {
      stream(request, signal): LlmStream {
        if (request.system === CONDUCTOR_PLAN_SYSTEM) return planClient.stream(request, signal);
        started++;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 100_000, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as unknown as StreamEvent;
            yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x'.repeat(400) } } as unknown as StreamEvent;
            await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Anthropic.APIUserAbortError()), { once: true }));
          },
          finalMessage: () => Promise.reject(new Error('never')),
        };
      },
    };
    setClientFactory(() => client);
    const id = await createMission('긴 답변');
    await waitUntil(() => started >= 1, 'answer stream');
    await new Promise((r) => setTimeout(r, 30));
    await cancelOrDeleteMission(id);
    await waitForMission(id);
    await new Promise((r) => setTimeout(r, 50));
    const view = await getMissionView(id);
    expect(view?.status).toBe('cancelled');
    expect(view?.usage.inputTokens).toBeGreaterThanOrEqual(100_000);
    expect(view?.usage.costUsd).toBeGreaterThan(0.1);
  });
});

describe('deleting', () => {
  it('does not bring a mission back when delete follows cancel at once', async () => {
    const hold = deferred();
    const client = new FakeClient(async (request) => {
      if (request.system === CONDUCTOR_PLAN_SYSTEM) return { message: makeMessage([textBlock(JSON.stringify(ANSWER_PLAN))]) };
      await hold.promise;
      return { message: makeMessage([textBlock('답변')]) };
    });
    setClientFactory(() => client);
    for (let i = 0; i < 5; i++) {
      const id = await createMission(`지울 미션 ${i}`);
      await waitUntil(() => client.requests.length >= (i + 1) * 2, 'answer stream');
      await cancelOrDeleteMission(id);
      await cancelOrDeleteMission(id);
      await new Promise((r) => setTimeout(r, 60));
      expect((await listMissionSummaries()).some((s) => s.id === id)).toBe(false);
      expect(existsSync(dataPath('missions', `${id}.json`))).toBe(false);
      expect(existsSync(dataPath('missions', `${id}.jsonl`))).toBe(false);
    }
    hold.resolve();
  });

  it('waits for a running tool before delete-all, so its audit entry cannot reappear', async () => {
    const gate = deferred();
    register<{ query: string }>({
      name: 'slow_probe',
      description: 'test',
      risk: 'safe',
      group: 'files',
      agents: ['archivist'],
      schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
      summarize: ({ query }) => `느린 도구: ${query}`,
      async run() {
        await gate.promise;
        return '끝';
      },
    });
    let turn = 0;
    const client = new FakeClient((request) => {
      if (request.system === CONDUCTOR_PLAN_SYSTEM) {
        const plan: MissionPlan = { title: 'x', route: 'team', steps: [{ id: 's1', agent: 'archivist', title: '단계', task: '수행', dependsOn: [] }] };
        return { message: makeMessage([textBlock(JSON.stringify(plan))]) };
      }
      return turn++ === 0 ? { message: makeMessage([toolUseBlock('t1', 'slow_probe', { query: '내-검색어-비밀' })], 'tool_use') } : { message: makeMessage([textBlock('끝')]) };
    });
    setClientFactory(() => client);
    const id = await createMission('느린 도구');
    await waitUntil(async () => (await getMissionView(id))?.steps.s1?.toolCalls.length === 1, 'tool started');

    const purge = purgeAllMissions();
    await new Promise((r) => setTimeout(r, 30));
    gate.resolve();
    await purge;
    await deleteAllData();
    await new Promise((r) => setTimeout(r, 60));
    const audit = existsSync(dataPath('audit.jsonl')) ? readFileSync(dataPath('audit.jsonl'), 'utf8') : '';
    expect(audit).not.toContain('내-검색어-비밀');
    await fs.rm(dataPath('audit.jsonl'), { force: true });
  });
});
