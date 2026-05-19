const TOKEN_KEY = 'rac_token';
const COOKIE_SESSION_MARKER = 'cookie-session';
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const SSE_BASE = (
  import.meta.env.VITE_SSE_URL ||
  `${API_BASE}/api/stream` ||
  '/api/stream'
).replace(/\/$/, '');
const WS_BASE = (import.meta.env.VITE_WS_URL || '').replace(/\/$/, '');

type ApiDataEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: string | { message?: string };
};

export function resolveUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  if (!API_BASE) {
    return path;
  }

  return `${API_BASE}${path}`;
}

export function resolveWebSocketUrl(path: string): string {
  if (/^wss?:\/\//.test(path)) {
    return path;
  }

  const resolved = WS_BASE ? `${WS_BASE}${path}` : resolveUrl(path);
  const url = new URL(resolved, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function resolveSseBaseUrl(): string {
  return /^https?:\/\//.test(SSE_BASE) ? SSE_BASE : resolveUrl(SSE_BASE);
}

let sessionMarker: string | null = null;

function readSessionMarker(): string | null {
  const stored = localStorage.getItem(TOKEN_KEY);
  if (stored === COOKIE_SESSION_MARKER) {
    return COOKIE_SESSION_MARKER;
  }
  if (stored) {
    localStorage.removeItem(TOKEN_KEY);
  }
  return null;
}

export function getToken(): string | null {
  sessionMarker = sessionMarker ?? readSessionMarker();
  return sessionMarker;
}

export function setToken(_token = 'cookie-session'): void {
  sessionMarker = COOKIE_SESSION_MARKER;
  localStorage.setItem(TOKEN_KEY, COOKIE_SESSION_MARKER);
}

export function clearToken(): void {
  sessionMarker = null;
  localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  // Default to JSON body when body is provided and content-type not set.
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const method = (options.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !headers['X-RAC-CSRF']) {
    headers['X-RAC-CSRF'] = '1';
  }

  const res = await fetch(resolveUrl(path), {
    ...options,
    headers,
    credentials: options.credentials ?? 'include',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = `Request failed: ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
    try {
      const json = JSON.parse(text);
      if (json.message) message = json.message;
      else if (json.error) message = json.error;
    } catch {
      const looksLikeHtml = /^\s*<!doctype html/i.test(text) || /^\s*<html[\s>]/i.test(text);
      if (text && !looksLikeHtml) message = text;
    }
    throw new Error(message);
  }

  const json = await res.json();
  if (json?.ok === false) {
    const message = json?.error?.message || json?.error || 'Request failed';
    throw new Error(message);
  }
  return json as T;
}

export async function apiFetchData<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await apiFetch<ApiDataEnvelope<T>>(path, options);
  if (!('data' in response)) {
    throw new Error('API response did not include data.');
  }
  return response.data as T;
}
