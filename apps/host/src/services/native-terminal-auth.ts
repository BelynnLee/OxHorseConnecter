import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { verifyToken } from '@rac/security';
import { config } from '../config.js';

export type NativeTerminalAuthIdentity = {
  userId: string;
  username: string;
};

export function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }

  return cookies;
}

export function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function requestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? '/', config.publicBaseUrl);
}

function tokenFromRequest(request: IncomingMessage, url: URL): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice(7);
  }

  const cookieToken = parseCookieHeader(request.headers.cookie).get(config.authCookieName);
  if (cookieToken) return cookieToken;

  return config.allowQueryTokenAuth ? (url.searchParams.get('token') ?? undefined) : undefined;
}

export function authenticateNativeTerminalRequest(
  request: IncomingMessage,
  url: URL
): NativeTerminalAuthIdentity | null {
  const token = tokenFromRequest(request, url);
  if (!token) return null;

  const payload = verifyToken(token, config.jwtSecret);
  if (!payload) return null;

  return {
    userId: payload.userId,
    username: payload.username,
  };
}

function forwardedProto(request: IncomingMessage): string | undefined {
  const value = request.headers['x-forwarded-proto'];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.split(',')[0]?.trim().toLowerCase();
}

export function requestIsHttps(request: IncomingMessage): boolean {
  return (
    Boolean((request.socket as { encrypted?: boolean }).encrypted) ||
    forwardedProto(request) === 'https'
  );
}

export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  return origin === config.publicBaseUrl || config.corsOrigins.includes(origin);
}

export function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
  socket.write(
    [`HTTP/1.1 ${statusCode} ${message}`, 'Connection: close', 'Content-Length: 0', '', ''].join(
      '\r\n'
    )
  );
  socket.destroy();
}
