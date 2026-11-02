import { addMemory } from '@/lib/store/memory';
import { register } from './registry';

register<{ text: string }>({
  name: 'remember',
  description:
    '사용자가 앞으로도 기억해 달라고 한 사실이나 선호를 저장합니다. 모든 미션의 에이전트가 이 내용을 읽으므로 사용자의 승인이 필요합니다.',
  risk: 'confirm',
  group: 'memory',
  agents: ['planner'],
  schema: {
    type: 'object',
    properties: { text: { type: 'string', minLength: 1, maxLength: 500 } },
    required: ['text'],
    additionalProperties: false,
  },
  summarize: ({ text }) => `기억하기: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`,
  async preview({ text }) {
    return { kind: 'text', text };
  },
  async run({ text }) {
    const item = await addMemory(text, 'agent');
    return `기억했습니다: ${item.text}`;
  },
});
