import type { ApiResponse } from '../types.ts';
import { apiFetch } from './client.ts';

export async function analyzeFailure(input: {
  sessionId?: string;
  logs?: string;
  error?: string;
}): Promise<Record<string, unknown>> {
  const res = await apiFetch<ApiResponse<Record<string, unknown>>>(
    '/api/failure-analysis/analyze',
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
  return res.data!;
}
