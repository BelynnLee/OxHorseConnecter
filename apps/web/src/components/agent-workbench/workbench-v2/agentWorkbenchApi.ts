import { mockAgentWorkbenchApi } from './mockAgentWorkbenchApi.ts';
import { realAgentWorkbenchApi } from './realAgentWorkbenchApi.ts';
import type { AgentWorkbenchApi } from './types.ts';

export type AgentWorkbenchApiSource = 'real' | 'mock';

export function getAgentWorkbenchApi(source: AgentWorkbenchApiSource = 'real'): AgentWorkbenchApi {
  return source === 'mock' ? mockAgentWorkbenchApi : realAgentWorkbenchApi;
}
