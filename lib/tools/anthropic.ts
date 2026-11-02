import './index';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentId } from '@/lib/contracts';
import { toolsForAgent } from './registry';

/**
 * 에이전트에게 줄 Claude 도구 정의. 이름순으로 고정하고 설명에 바뀌는 값을 넣지 않아
 * 프롬프트 캐시가 유지되게 한다. eager_input_streaming 입력은 서버 검증을 거치지 않으므로
 * executeTool의 스키마 검증을 반드시 통과시킨다.
 */
export function anthropicToolsFor(agent: AgentId): Anthropic.Messages.Tool[] {
  return toolsForAgent(agent).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.schema as Anthropic.Messages.Tool.InputSchema,
    eager_input_streaming: true,
  }));
}
