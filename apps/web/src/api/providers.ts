import type {
  ApiResponse,
  ProviderConfigInput,
  ProviderProbeResult,
  PublicProviderConfig,
} from '../types.ts';
import { apiFetch } from './client.ts';

export async function getControlPlaneProviders(): Promise<PublicProviderConfig[]> {
  const res = await apiFetch<ApiResponse<PublicProviderConfig[]>>('/api/providers');
  return res.data!;
}

export async function createControlPlaneProvider(
  input: ProviderConfigInput
): Promise<PublicProviderConfig> {
  const res = await apiFetch<ApiResponse<PublicProviderConfig>>('/api/providers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data!;
}

export async function updateControlPlaneProvider(
  id: string,
  input: Partial<ProviderConfigInput>
): Promise<PublicProviderConfig> {
  const res = await apiFetch<ApiResponse<PublicProviderConfig>>(
    `/api/providers/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    }
  );
  return res.data!;
}

export async function deleteControlPlaneProvider(id: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function testControlPlaneProvider(id: string): Promise<ProviderProbeResult> {
  const res = await apiFetch<ApiResponse<ProviderProbeResult>>(
    `/api/providers/${encodeURIComponent(id)}/test`,
    { method: 'POST' }
  );
  return res.data!;
}
