import type {
  CreateDeviceCredentialInput,
  Device,
  DeviceCredential,
  DeviceCredentialWithToken,
  ExecutorInfo,
  ExecutorType,
} from '../types.ts';
import { apiFetchData } from './client.ts';

export async function getDevices(): Promise<Device[]> {
  return apiFetchData<Device[]>('/api/devices');
}

export async function trustDevice(id: string): Promise<Device> {
  return apiFetchData<Device>(`/api/devices/${id}/trust`, { method: 'POST' });
}

export async function untrustDevice(id: string): Promise<Device> {
  return apiFetchData<Device>(`/api/devices/${id}/untrust`, { method: 'POST' });
}

export async function getDeviceCredentials(deviceId: string): Promise<DeviceCredential[]> {
  return apiFetchData<DeviceCredential[]>(
    `/api/devices/${encodeURIComponent(deviceId)}/credentials`
  );
}

export async function createDeviceCredential(
  deviceId: string,
  input: CreateDeviceCredentialInput = {}
): Promise<DeviceCredentialWithToken> {
  return apiFetchData<DeviceCredentialWithToken>(
    `/api/devices/${encodeURIComponent(deviceId)}/credentials`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
}

export async function revokeDeviceCredential(
  deviceId: string,
  credentialId: string
): Promise<DeviceCredential[]> {
  return apiFetchData<DeviceCredential[]>(
    `/api/devices/${encodeURIComponent(deviceId)}/credentials/${encodeURIComponent(credentialId)}/revoke`,
    { method: 'POST' }
  );
}

export async function getExecutors(): Promise<ExecutorType[]> {
  return apiFetchData<ExecutorType[]>('/api/executors');
}

export async function probeExecutors(): Promise<ExecutorInfo[]> {
  return apiFetchData<ExecutorInfo[]>('/api/executors/probe', {
    method: 'POST',
  });
}

export interface DirEntry {
  name: string;
  path: string;
}

export interface BrowseResult {
  current: string;
  root: string;
  parent: string | null;
  drives: string[] | null;
  dirs: DirEntry[];
}

export async function browseDirs(dirPath?: string, deviceId?: string): Promise<BrowseResult> {
  const query = new URLSearchParams();
  if (dirPath) query.set('path', dirPath);
  if (deviceId) query.set('deviceId', deviceId);
  const qs = query.toString() ? `?${query.toString()}` : '';
  return apiFetchData<BrowseResult>(`/api/browse${qs}`);
}
