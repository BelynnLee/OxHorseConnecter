import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { DeviceRepository, EventRepository, TaskRepository, UserRepository } from '@rac/storage';
import { hashPassword } from '@rac/security';
import { probeExecutors } from '@rac/executors';
import type { Device, User } from '@rac/shared';
import { config } from './config.js';

interface StaleSessionRow {
  id: string;
  activeTaskId: string | null;
  taskStatus: string | null;
  assistantMessageId: string | null;
  assistantContent: string | null;
}

export function ensureAdminUser(db: Database.Database): User {
  const userRepo = new UserRepository(db);
  const existing = userRepo.findByUsername(config.adminUsername);

  const user: User & { passwordHash: string } = {
    id: existing?.id ?? `user-${config.adminUsername}`,
    username: config.adminUsername,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    passwordHash: hashPassword(config.adminPassword),
  };

  userRepo.upsert(user);

  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
  };
}

export function ensureHostDevice(db: Database.Database): Device {
  const deviceRepo = new DeviceRepository(db);
  const existing = deviceRepo.findByFingerprint(config.hostDeviceFingerprint);

  const executors = probeExecutors({
    claudeCommand: config.executorRegistry.claudeCodeOptions?.command,
    codexCommand: config.executorRegistry.codexOptions?.command,
    customCommand: config.executorRegistry.customCommandOptions?.command,
  });

  if (existing) {
    deviceRepo.updateTrust(existing.id, true);
    deviceRepo.updateHeartbeat(existing.id, {
      status: 'online',
      executors,
      workRoot: config.allowedWorkDir ?? process.cwd(),
      workRootExists: true,
    });
    return {
      ...existing,
      status: 'online',
      lastSeenAt: new Date().toISOString(),
      hostVersion: config.hostVersion,
      trusted: true,
      executors,
      workRoot: config.allowedWorkDir ?? process.cwd(),
      workRootExists: true,
    };
  }

  const now = new Date().toISOString();
  const device: Device = {
    id: uuid(),
    name: config.hostDeviceName,
    status: 'online',
    platform: config.hostDevicePlatform,
    lastSeenAt: now,
    createdAt: now,
    fingerprint: config.hostDeviceFingerprint,
    trusted: true,
    hostVersion: config.hostVersion,
    executors,
    workRoot: config.allowedWorkDir ?? process.cwd(),
    workRootExists: true,
  };

  deviceRepo.create(device);
  return device;
}

export interface RecoveryReport {
  recoveredTasks: number;
  recoveredSessions: number;
}

export function recoverStuckTasks(db: Database.Database): RecoveryReport {
  const taskRepo = new TaskRepository(db);
  const eventRepo = new EventRepository(db);
  const stuckTasks = taskRepo.findByStatuses(['queued', 'running', 'waiting_approval']);

  const now = new Date().toISOString();
  const recoveredTaskIds = new Set<string>();
  const recoveryMessageByTaskId = new Map<string, string>();

  for (const task of stuckTasks) {
    const errorMessage = 'Host restarted while task was in progress.';
    recoveredTaskIds.add(task.id);
    recoveryMessageByTaskId.set(task.id, errorMessage);

    taskRepo.updateStatus(task.id, 'failed', {
      finishedAt: now,
      errorMessage,
    });

    eventRepo.create({
      id: uuid(),
      taskId: task.id,
      type: 'task.failed',
      level: 'error',
      payload: { errorMessage },
      createdAt: now,
    });
  }

  const staleSessions = db.prepare(
    `SELECT
       s.id,
       s.activeTaskId,
       t.status AS taskStatus,
       m.id AS assistantMessageId,
       m.content AS assistantContent
     FROM sessions s
     LEFT JOIN tasks t ON t.id = s.activeTaskId
     LEFT JOIN session_messages m ON m.id = (
       SELECT sm.id
       FROM session_messages sm
       WHERE sm.sessionId = s.id
         AND sm.role = 'assistant'
         AND (s.activeTaskId IS NULL OR sm.taskId = s.activeTaskId)
       ORDER BY sm.sequence DESC
       LIMIT 1
     )
     WHERE s.status IN ('running', 'waiting_approval')`,
  ).all() as StaleSessionRow[];

  let recoveredSessionCount = 0;
  for (const session of staleSessions) {
    const taskRecovered = session.activeTaskId ? recoveredTaskIds.has(session.activeTaskId) : false;
    const taskAlreadyTerminal =
      session.taskStatus === null ||
      session.taskStatus === 'completed' ||
      session.taskStatus === 'failed' ||
      session.taskStatus === 'cancelled';
    if (session.activeTaskId && !taskRecovered && !taskAlreadyTerminal) {
      continue;
    }

    recoveredSessionCount += 1;
    const errorMessage = session.activeTaskId
      ? recoveryMessageByTaskId.get(session.activeTaskId) ?? 'Host restarted before the active task could report completion.'
      : 'Host restarted while session was marked running without an active task.';

    db.prepare(
      `UPDATE sessions
       SET status = 'failed',
           activeTaskId = NULL,
           lastMessageAt = ?,
           updatedAt = ?
       WHERE id = ?`,
    ).run(now, now, session.id);

    if (session.assistantMessageId) {
      const current = session.assistantContent?.trim() ?? '';
      const content = current.includes(errorMessage)
        ? current
        : [current, errorMessage].filter(Boolean).join('\n\n');
      db.prepare(
        `UPDATE session_messages
         SET content = ?,
             status = 'failed'
         WHERE id = ?`,
      ).run(content, session.assistantMessageId);
    }

    if (session.activeTaskId) {
      db.prepare(
        `UPDATE session_messages
         SET status = 'failed'
         WHERE sessionId = ?
           AND taskId = ?
           AND status = 'streaming'`,
      ).run(session.id, session.activeTaskId);
    } else {
      db.prepare(
        `UPDATE session_messages
         SET status = 'failed'
         WHERE sessionId = ?
           AND status = 'streaming'`,
      ).run(session.id);
    }

    db.prepare(
      `UPDATE agent_commands
       SET finishedAt = ?,
           exitCode = COALESCE(exitCode, 1)
       WHERE sessionId = ?
         AND finishedAt IS NULL`,
    ).run(now, session.id);

    db.prepare(
      `INSERT INTO session_messages (
         id, sessionId, taskId, role, type, content, status, modelId, metadata, createdAt, sequence
       )
       VALUES (
         @id,
         @sessionId,
         @taskId,
         'system',
         'error',
         @content,
         'failed',
         NULL,
         @metadata,
         @createdAt,
         (SELECT COALESCE(MAX(sequence), 0) + 1 FROM session_messages WHERE sessionId = @sessionId)
       )`,
    ).run({
      id: uuid(),
      sessionId: session.id,
      taskId: session.activeTaskId,
      content: errorMessage,
      metadata: JSON.stringify({ source: 'host-recovery', activeTaskId: session.activeTaskId }),
      createdAt: now,
    });
  }

  return {
    recoveredTasks: stuckTasks.length,
    recoveredSessions: recoveredSessionCount,
  };
}
