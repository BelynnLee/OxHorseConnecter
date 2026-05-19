import type { ApiResponse } from '../types.ts';
import { apiFetch } from './client.ts';

export interface McpTool {
  name: string;
  description: string;
  mutating: boolean;
  inputSchema: Record<string, unknown>;
}

export async function getMcpTools(): Promise<McpTool[]> {
  const res = await apiFetch<ApiResponse<McpTool[]>>('/api/mcp/tools');
  return res.data!;
}

export async function callMcpTool(input: {
  name: string;
  arguments?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const res = await apiFetch<ApiResponse<Record<string, unknown>>>('/api/mcp/tools/call', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data!;
}
