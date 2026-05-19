import { Router } from 'express';
import { SecurityAuditRepository, UserRepository } from '@rac/storage';
import {
  AUTH_RATE_LIMIT_SCOPE_LOGIN,
  comparePassword,
  createAuthRateLimiter,
  generateToken,
  hashPassword,
  isPasswordHashSecure,
} from '@rac/security';
import { createLogger } from '@rac/logger';
import { config } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';
import { writeMissingEnvValues } from '../services/env-file.js';
import { auditFromRequest } from '../services/security-audit.js';

const log = createLogger('auth');
import type { AuthRequest } from '../middleware/auth.js';
import type { Request, Response } from 'express';
import type Database from 'better-sqlite3';

const MAX_LOGIN_FIELD_LENGTH = 1024;

function getClientIp(req: Request): string | undefined {
  return req.ip || req.socket.remoteAddress;
}

function setAuthCookie(res: Response, token: string): void {
  res.cookie(config.authCookieName, token, {
    httpOnly: true,
    secure: config.authCookieSecure,
    sameSite: config.authCookieSameSite,
    maxAge: config.accessTokenTtlSeconds * 1000,
    path: '/',
  });
}

function clearAuthCookie(res: Response): void {
  res.clearCookie(config.authCookieName, {
    httpOnly: true,
    secure: config.authCookieSecure,
    sameSite: config.authCookieSameSite,
    path: '/',
  });
}

async function persistBootstrapSecrets(username: string, password: string): Promise<void> {
  const values: Record<string, string> = {};

  if (config.jwtSecretGenerated) {
    values.JWT_SECRET = config.jwtSecret;
  }

  if (config.adminPasswordGenerated && username === config.adminUsername) {
    values.ADMIN_PASSWORD = password;
  }

  if (Object.keys(values).length === 0) {
    return;
  }

  const writtenKeys = await writeMissingEnvValues(values);
  if (writtenKeys.length > 0) {
    log.info({ keys: writtenKeys }, 'Persisted bootstrap configuration to .env');
  }
}

export function createAuthRouter(db: Database.Database): Router {
  const router = Router();
  const userRepo = new UserRepository(db);
  const auditRepo = new SecurityAuditRepository(db);
  const loginRateLimiter = createAuthRateLimiter(config.loginRateLimit);

  function auditLoginFailure(req: Request, reason: string, username?: string): void {
    auditFromRequest(auditRepo, req, {
      eventType: 'auth.login_failed',
      severity: reason === 'rate_limited' ? 'warn' : 'info',
      actorType: 'user',
      message: 'Login failed.',
      metadata: { reason, username },
    });
  }

  router.post('/login', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    const clientIp = getClientIp(req);
    const rateLimit = loginRateLimiter.check(clientIp, AUTH_RATE_LIMIT_SCOPE_LOGIN);
    if (!rateLimit.allowed) {
      auditLoginFailure(req, 'rate_limited');
      res.setHeader('Retry-After', String(Math.ceil(rateLimit.retryAfterMs / 1000)));
      res.status(429).json({
        ok: false,
        error: 'Too many failed login attempts. Try again later.',
      });
      return;
    }

    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username || !password) {
      auditLoginFailure(req, 'missing_credentials', username);
      res.status(400).json({ ok: false, error: 'Username and password required' });
      return;
    }
    if (username.length > MAX_LOGIN_FIELD_LENGTH || password.length > MAX_LOGIN_FIELD_LENGTH) {
      loginRateLimiter.recordFailure(clientIp, AUTH_RATE_LIMIT_SCOPE_LOGIN);
      auditLoginFailure(req, 'field_too_long', username);
      res.status(400).json({ ok: false, error: 'Username or password is too long' });
      return;
    }

    const user = userRepo.findByUsername(username);
    if (!user) {
      loginRateLimiter.recordFailure(clientIp, AUTH_RATE_LIMIT_SCOPE_LOGIN);
      auditLoginFailure(req, 'unknown_user', username);
      res.status(401).json({ ok: false, error: 'Invalid credentials' });
      return;
    }

    const hash = userRepo.getPasswordHash(username);
    if (!hash || !comparePassword(password, hash)) {
      loginRateLimiter.recordFailure(clientIp, AUTH_RATE_LIMIT_SCOPE_LOGIN);
      auditLoginFailure(req, 'invalid_password', username);
      res.status(401).json({ ok: false, error: 'Invalid credentials' });
      return;
    }
    loginRateLimiter.reset(clientIp, AUTH_RATE_LIMIT_SCOPE_LOGIN);

    if (!isPasswordHashSecure(hash)) {
      userRepo.upsert({
        ...user,
        passwordHash: hashPassword(password),
      });
    }

    try {
      await persistBootstrapSecrets(username, password);
    } catch (err) {
      log.warn({ err }, 'Failed to persist bootstrap configuration after login');
    }

    const token = generateToken(
      { userId: user.id, username: user.username },
      config.jwtSecret,
      `${config.accessTokenTtlSeconds}s`,
    );
    setAuthCookie(res, token);
    auditFromRequest(auditRepo, req, {
      eventType: 'auth.login_succeeded',
      actorType: 'user',
      actorId: user.id,
      message: 'Login succeeded.',
      metadata: { username: user.username },
    });

    res.json({
      ok: true,
      data: { user },
    });
  });

  router.post('/logout', (_req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', authMiddleware, (req: AuthRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');

    const user = userRepo.findById(req.userId!);
    if (!user) {
      res.status(404).json({ ok: false, error: 'User not found' });
      return;
    }
    res.json({ ok: true, data: user });
  });

  return router;
}
