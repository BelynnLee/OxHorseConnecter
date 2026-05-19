import { Router } from 'express';
import { readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { authMiddleware } from '../middleware/auth.js';
import { config } from '../config.js';
import type { NativeTerminalService } from '../services/native-terminal-service.js';

export interface BrowseDirectoryResult {
  current: string;
  root: string;
  parent: string | null;
  drives: null;
  dirs: Array<{ name: string; path: string }>;
}

class BrowseError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

function insideOrSame(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function allowedBrowseRoot(): string {
  return realpathSync(path.resolve(config.allowedWorkDir ?? process.cwd()));
}

export function resolveBrowseDirectory(rawPath = ''): BrowseDirectoryResult {
  const root = allowedBrowseRoot();
  const requested = rawPath ? path.resolve(rawPath) : root;

  let safePath: string;
  try {
    safePath = realpathSync(requested);
  } catch {
    throw new BrowseError('Directory not found.', 404);
  }

  if (!insideOrSame(safePath, root)) {
    throw new BrowseError('Path is outside ALLOWED_WORK_DIR.', 400);
  }

  if (!statSync(safePath).isDirectory()) {
    throw new BrowseError('Path is not a directory.', 400);
  }

  let entries: string[] = [];
  try {
    entries = readdirSync(safePath)
      .filter((name) => {
        try {
          return statSync(path.join(safePath, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  } catch {
    entries = [];
  }

  return {
    current: safePath,
    root,
    parent: safePath !== root ? path.dirname(safePath) : null,
    drives: null,
    dirs: entries.map((name) => ({
      name,
      path: path.join(safePath, name),
    })),
  };
}

export function createBrowseRouter(
  nativeTerminalService?: NativeTerminalService,
  hostDeviceId = 'host',
): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get('/', async (req, res) => {
    const rawPath = typeof req.query.path === 'string' ? req.query.path : '';
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId.trim() : '';
    try {
      if (deviceId && deviceId !== hostDeviceId) {
        if (!nativeTerminalService) {
          res.status(503).json({ ok: false, error: 'Remote browse service is not available.' });
          return;
        }
        const data = await nativeTerminalService.browseRemoteDirectory(deviceId, rawPath);
        res.json({ ok: true, data });
        return;
      }

      res.json({ ok: true, data: resolveBrowseDirectory(rawPath) });
    } catch (error) {
      const statusCode = error instanceof BrowseError
        ? error.statusCode
        : typeof (error as { statusCode?: unknown }).statusCode === 'number'
          ? (error as { statusCode: number }).statusCode
          : 500;
      const message = error instanceof Error ? error.message : 'Browse failed.';
      res.status(statusCode).json({ ok: false, error: message });
    }
  });

  return router;
}
