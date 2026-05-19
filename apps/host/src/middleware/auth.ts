import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '@rac/security';
import { config } from '../config.js';

export interface AuthRequest extends Request {
  userId?: string;
  username?: string;
}

function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) {
    return cookies;
  }

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) {
      continue;
    }

    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) {
      continue;
    }

    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }

  return cookies;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const queryToken =
    config.allowQueryTokenAuth && typeof req.query.token === 'string'
      ? req.query.token
      : undefined;
  const cookieToken = parseCookieHeader(req.headers.cookie).get(config.authCookieName);

  let token: string | undefined;
  if (header?.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (cookieToken) {
    token = cookieToken;
  } else if (queryToken) {
    token = queryToken;
  }

  if (!token) {
    res.status(401).json({ ok: false, error: 'Missing or invalid authorization header' });
    return;
  }

  const payload = verifyToken(token, config.jwtSecret);
  if (!payload) {
    res.status(401).json({ ok: false, error: 'Invalid or expired token' });
    return;
  }

  req.userId = payload.userId;
  req.username = payload.username;
  next();
}
