import type Database from 'better-sqlite3';

function hasColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
): boolean {
  const rows = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  return rows.some((row) => row.name === columnName);
}

function ensureColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  if (!hasColumn(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function hasLegacyProjectPathUniqueIndex(db: Database.Database): boolean {
  const indexes = db.prepare('PRAGMA index_list(projects)').all() as Array<{
    name: string;
    unique: number;
  }>;
  return indexes.some((index) => {
    if (index.unique !== 1) return false;
    const columns = db.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{ name: string }>;
    return columns.length === 1 && columns[0]?.name === 'path';
  });
}

function rebuildProjectsTableForDeviceScopedPaths(db: Database.Database): void {
  if (!hasLegacyProjectPathUniqueIndex(db)) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects_next (
      id            TEXT PRIMARY KEY,
      deviceId      TEXT NOT NULL DEFAULT '',
      name          TEXT NOT NULL,
      path          TEXT NOT NULL,
      gitRemote     TEXT,
      defaultBranch TEXT,
      description   TEXT,
      enabled       INTEGER NOT NULL DEFAULT 1,
      createdAt     TEXT NOT NULL,
      updatedAt     TEXT NOT NULL
    );

    INSERT OR IGNORE INTO projects_next (
      id, deviceId, name, path, gitRemote, defaultBranch, description, enabled, createdAt, updatedAt
    )
    SELECT
      id, deviceId, name, path, gitRemote, defaultBranch, description, enabled, createdAt, updatedAt
    FROM projects;

    DROP TABLE projects;
    ALTER TABLE projects_next RENAME TO projects;
  `);
}

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      passwordHash  TEXT NOT NULL,
      createdAt     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'offline',
      platform      TEXT NOT NULL,
      lastSeenAt    TEXT NOT NULL,
      createdAt     TEXT NOT NULL,
      fingerprint   TEXT UNIQUE NOT NULL,
      trusted       INTEGER NOT NULL DEFAULT 0,
      hostVersion   TEXT,
      executors     TEXT,
      workRoot      TEXT,
      workRootExists INTEGER NOT NULL DEFAULT 0,
      lastHeartbeatAt TEXT,
      lastBridgeConnectedAt TEXT,
      lastBridgeDisconnectedAt TEXT,
      bridgeStatus TEXT,
      lastDisconnectReason TEXT,
      workerReconnectCount INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS device_credentials (
      id            TEXT PRIMARY KEY,
      deviceId      TEXT NOT NULL,
      tokenHash     TEXT NOT NULL,
      tokenPrefix   TEXT NOT NULL,
      name          TEXT,
      scopes        TEXT NOT NULL DEFAULT '[]',
      createdAt     TEXT NOT NULL,
      lastUsedAt    TEXT,
      expiresAt     TEXT,
      revokedAt     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_device_credentials_device
      ON device_credentials (deviceId, createdAt);

    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      deviceId      TEXT NOT NULL,
      executorType  TEXT NOT NULL,
      title         TEXT NOT NULL,
      prompt        TEXT NOT NULL,
      mode          TEXT NOT NULL DEFAULT 'agent',
      permissionMode TEXT NOT NULL DEFAULT 'default',
      workDir       TEXT,
      autoApprove   INTEGER NOT NULL DEFAULT 0,
      retryCount    INTEGER NOT NULL DEFAULT 0,
      maxRetries    INTEGER NOT NULL DEFAULT 0,
      parentTaskId  TEXT,
      parentGroupId TEXT,
      resumeSessionId TEXT,
      modelId       TEXT,
      reasoningEffort TEXT,
      runtimeOptions TEXT,
      status        TEXT NOT NULL DEFAULT 'queued',
      createdBy     TEXT NOT NULL,
      createdAt     TEXT NOT NULL,
      startedAt     TEXT,
      finishedAt    TEXT,
      summary       TEXT,
      errorMessage  TEXT
    );

    CREATE TABLE IF NOT EXISTS task_events (
      id            TEXT PRIMARY KEY,
      seq           INTEGER,
      taskId        TEXT NOT NULL,
      type          TEXT NOT NULL,
      level         TEXT NOT NULL DEFAULT 'info',
      payload       TEXT NOT NULL DEFAULT '{}',
      createdAt     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_task_events_taskId_createdAt
      ON task_events (taskId, createdAt);

    CREATE TABLE IF NOT EXISTS approvals (
      id            TEXT PRIMARY KEY,
      taskId        TEXT NOT NULL,
      actionType    TEXT NOT NULL,
      riskLevel     TEXT NOT NULL,
      reason        TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      createdAt     TEXT NOT NULL,
      resolvedAt    TEXT,
      resolvedBy    TEXT,
      timeoutAt     TEXT,
      commandPreview TEXT,
      targetPaths   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_approvals_taskId
      ON approvals (taskId);

    CREATE TABLE IF NOT EXISTS diff_summaries (
      id            TEXT PRIMARY KEY,
      taskId        TEXT UNIQUE NOT NULL,
      filesChanged  INTEGER NOT NULL DEFAULT 0,
      insertions    INTEGER NOT NULL DEFAULT 0,
      deletions     INTEGER NOT NULL DEFAULT 0,
      patchText     TEXT NOT NULL DEFAULT '',
      createdAt     TEXT NOT NULL,
      files         TEXT
    );

    CREATE TABLE IF NOT EXISTS task_templates (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT,
      executorType  TEXT NOT NULL,
      prompt        TEXT NOT NULL,
      workDir       TEXT,
      autoApprove   INTEGER NOT NULL DEFAULT 0,
      createdAt     TEXT NOT NULL,
      updatedAt     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id            TEXT PRIMARY KEY,
      endpoint      TEXT UNIQUE NOT NULL,
      keys          TEXT NOT NULL,
      createdAt     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key           TEXT PRIMARY KEY,
      value         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      id            TEXT PRIMARY KEY,
      appliedAt     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      deviceId      TEXT NOT NULL DEFAULT '',
      name          TEXT NOT NULL,
      path          TEXT NOT NULL,
      gitRemote     TEXT,
      defaultBranch TEXT,
      description   TEXT,
      enabled       INTEGER NOT NULL DEFAULT 1,
      createdAt     TEXT NOT NULL,
      updatedAt     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_sessions (
      id               TEXT PRIMARY KEY,
      projectId        TEXT,
      deviceId         TEXT NOT NULL,
      title            TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'created',
      agentType        TEXT NOT NULL,
      provider         TEXT NOT NULL,
      model            TEXT,
      permissionMode   TEXT NOT NULL DEFAULT 'default',
      workingDirectory TEXT,
      createdBy        TEXT NOT NULL,
      createdAt        TEXT NOT NULL,
      updatedAt        TEXT NOT NULL,
      archived         INTEGER NOT NULL DEFAULT 0,
      activeRunId      TEXT,
      metadata         TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_agent_sessions_project_updated
      ON agent_sessions (projectId, archived, updatedAt);

    CREATE TABLE IF NOT EXISTS agent_runs (
      id            TEXT PRIMARY KEY,
      sessionId     TEXT NOT NULL,
      projectId     TEXT,
      provider      TEXT NOT NULL,
      model         TEXT,
      status        TEXT NOT NULL DEFAULT 'queued',
      prompt        TEXT NOT NULL DEFAULT '',
      startedAt     TEXT,
      finishedAt    TEXT,
      createdAt     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runs_session_created
      ON agent_runs (sessionId, createdAt);

    CREATE TABLE IF NOT EXISTS agent_events (
      id            TEXT PRIMARY KEY,
      seq           INTEGER,
      sessionId     TEXT NOT NULL,
      runId         TEXT,
      type          TEXT NOT NULL,
      payload       TEXT NOT NULL DEFAULT '{}',
      schemaVersion INTEGER NOT NULL DEFAULT 1,
      createdAt     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_events_session_seq
      ON agent_events (sessionId, seq);

    CREATE TABLE IF NOT EXISTS agent_approvals (
      id            TEXT PRIMARY KEY,
      sessionId     TEXT,
      runId         TEXT,
      actionType    TEXT NOT NULL,
      riskLevel     TEXT NOT NULL,
      reason        TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      createdAt     TEXT NOT NULL,
      resolvedAt    TEXT,
      resolvedBy    TEXT,
      timeoutAt     TEXT,
      commandPreview TEXT,
      targetPaths   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_approvals_session
      ON agent_approvals (sessionId, createdAt);

    CREATE TABLE IF NOT EXISTS session_diffs (
      id            TEXT PRIMARY KEY,
      sessionId     TEXT NOT NULL,
      runId         TEXT,
      filesChanged  INTEGER NOT NULL DEFAULT 0,
      insertions    INTEGER NOT NULL DEFAULT 0,
      deletions     INTEGER NOT NULL DEFAULT 0,
      patchText     TEXT NOT NULL DEFAULT '',
      files         TEXT,
      createdAt     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_session_diffs_session
      ON session_diffs (sessionId, createdAt);

    CREATE TABLE IF NOT EXISTS provider_configs (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      type          TEXT NOT NULL,
      baseUrl       TEXT,
      apiKeyEncrypted TEXT,
      models        TEXT NOT NULL DEFAULT '[]',
      timeoutMs     INTEGER,
      enabled       INTEGER NOT NULL DEFAULT 1,
      usagePurpose  TEXT NOT NULL DEFAULT 'general',
      readonly      INTEGER NOT NULL DEFAULT 0,
      createdAt     TEXT NOT NULL,
      updatedAt     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_provider_configs_enabled
      ON provider_configs (enabled, usagePurpose);

    CREATE TABLE IF NOT EXISTS agent_metrics (
      id            TEXT PRIMARY KEY,
      scope         TEXT NOT NULL,
      scopeId       TEXT,
      metrics       TEXT NOT NULL DEFAULT '{}',
      computedAt    TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_metrics_scope
      ON agent_metrics (scope, scopeId);

    CREATE TABLE IF NOT EXISTS eval_tasks (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      repo          TEXT NOT NULL,
      prompt        TEXT NOT NULL,
      expected      TEXT NOT NULL DEFAULT '{}',
      createdAt     TEXT NOT NULL,
      updatedAt     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS eval_runs (
      id            TEXT PRIMARY KEY,
      taskId        TEXT NOT NULL,
      sessionId     TEXT,
      agentType     TEXT NOT NULL,
      model         TEXT,
      useRag        INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'queued',
      metrics       TEXT NOT NULL DEFAULT '{}',
      report        TEXT,
      createdAt     TEXT NOT NULL,
      finishedAt    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_eval_runs_task_created
      ON eval_runs (taskId, createdAt);

    CREATE TABLE IF NOT EXISTS rag_indexes (
      id            TEXT PRIMARY KEY,
      projectId     TEXT NOT NULL,
      projectPath   TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      indexedFiles  INTEGER NOT NULL DEFAULT 0,
      indexedChunks INTEGER NOT NULL DEFAULT 0,
      lastError     TEXT,
      createdAt     TEXT NOT NULL,
      updatedAt     TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_indexes_project
      ON rag_indexes (projectId);

    CREATE TABLE IF NOT EXISTS rag_hits (
      id            TEXT PRIMARY KEY,
      sessionId     TEXT,
      projectId     TEXT NOT NULL,
      filePath      TEXT NOT NULL,
      symbol        TEXT,
      score         REAL NOT NULL DEFAULT 0,
      contentPreview TEXT NOT NULL DEFAULT '',
      createdAt     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rag_hits_session
      ON rag_hits (sessionId, createdAt);

    CREATE TABLE IF NOT EXISTS sessions (
      id               TEXT PRIMARY KEY,
      deviceId         TEXT NOT NULL,
      title            TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'idle',
      executorType     TEXT NOT NULL,
      mode             TEXT NOT NULL DEFAULT 'agent',
      permissionMode   TEXT NOT NULL DEFAULT 'default',
      modelId          TEXT,
      reasoningEffort  TEXT,
      createdBy        TEXT NOT NULL,
      createdAt        TEXT NOT NULL,
      updatedAt        TEXT NOT NULL,
      lastMessageAt    TEXT,
      workingDirectory TEXT,
      pinned           INTEGER NOT NULL DEFAULT 0,
      archived         INTEGER NOT NULL DEFAULT 0,
      activeTaskId     TEXT,
      currentPlan      TEXT,
      contextClearedAt TEXT,
      externalSessionId TEXT,
      runtimeOptions   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_device_updated
      ON sessions (deviceId, archived, pinned, updatedAt);

    CREATE TABLE IF NOT EXISTS session_baselines (
      sessionId      TEXT PRIMARY KEY,
      provider       TEXT,
      cwd            TEXT NOT NULL,
      isGitRepository INTEGER NOT NULL DEFAULT 0,
      gitHead        TEXT,
      branch         TEXT,
      statusText     TEXT NOT NULL DEFAULT '',
      trackedDiff    TEXT NOT NULL DEFAULT '',
      trackedFiles   TEXT NOT NULL DEFAULT '[]',
      untrackedFiles TEXT NOT NULL DEFAULT '[]',
      fileSnapshots  TEXT NOT NULL DEFAULT '{}',
      createdAt      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_capabilities (
      provider       TEXT PRIMARY KEY,
      version        TEXT,
      capabilities   TEXT NOT NULL DEFAULT '{}',
      detectedAt     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS security_audit_events (
      id            TEXT PRIMARY KEY,
      eventType     TEXT NOT NULL,
      severity      TEXT NOT NULL,
      actorType     TEXT NOT NULL,
      actorId       TEXT,
      deviceId      TEXT,
      taskId        TEXT,
      sessionId     TEXT,
      ipAddress     TEXT,
      userAgent     TEXT,
      message       TEXT NOT NULL,
      metadata      TEXT,
      createdAt     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_security_audit_events_created
      ON security_audit_events (createdAt);

    CREATE INDEX IF NOT EXISTS idx_security_audit_events_type_created
      ON security_audit_events (eventType, createdAt);

    CREATE TABLE IF NOT EXISTS agent_permission_rules (
      id            TEXT PRIMARY KEY,
      provider      TEXT NOT NULL,
      deviceId      TEXT,
      projectPath   TEXT,
      scope         TEXT NOT NULL,
      ruleType      TEXT NOT NULL,
      pattern       TEXT NOT NULL,
      decision      TEXT NOT NULL,
      riskLevel     TEXT,
      enabled       INTEGER NOT NULL DEFAULT 1,
      description   TEXT,
      createdAt     TEXT NOT NULL,
      updatedAt     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_permission_rules_provider_enabled
      ON agent_permission_rules (provider, enabled, updatedAt);

    CREATE TABLE IF NOT EXISTS agent_permission_hits (
      id            TEXT PRIMARY KEY,
      sessionId     TEXT,
      ruleId        TEXT,
      provider      TEXT NOT NULL,
      inputType     TEXT NOT NULL,
      inputValue    TEXT NOT NULL,
      decision      TEXT NOT NULL,
      reason        TEXT NOT NULL,
      createdAt     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_permission_hits_created
      ON agent_permission_hits (createdAt);

    CREATE INDEX IF NOT EXISTS idx_agent_permission_hits_session
      ON agent_permission_hits (sessionId, createdAt);

    CREATE TABLE IF NOT EXISTS agent_commands (
      id            TEXT PRIMARY KEY,
      sessionId     TEXT NOT NULL,
      provider      TEXT NOT NULL,
      toolRunId     TEXT,
      command       TEXT NOT NULL,
      cwd           TEXT,
      startedAt     TEXT NOT NULL,
      finishedAt    TEXT,
      exitCode      INTEGER,
      stdoutPreview TEXT,
      stderrPreview TEXT,
      riskLevel     TEXT NOT NULL DEFAULT 'low',
      riskReason    TEXT,
      approvalId    TEXT,
      rawEventId    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_commands_session
      ON agent_commands (sessionId, startedAt);

    CREATE TABLE IF NOT EXISTS provider_raw_events (
      id            TEXT PRIMARY KEY,
      sessionId     TEXT NOT NULL,
      taskId        TEXT,
      provider      TEXT NOT NULL,
      source        TEXT,
      eventType     TEXT,
      taskEventId   TEXT,
      payload       TEXT NOT NULL DEFAULT '{}',
      createdAt     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_provider_raw_events_session
      ON provider_raw_events (sessionId, createdAt);

    CREATE TABLE IF NOT EXISTS agent_session_summaries (
      id            TEXT PRIMARY KEY,
      sessionId     TEXT NOT NULL,
      provider      TEXT NOT NULL,
      summary       TEXT NOT NULL,
      sourceEventFrom TEXT,
      sourceEventTo TEXT,
      injectedIntoProvider INTEGER NOT NULL DEFAULT 0,
      usedInResume  INTEGER NOT NULL DEFAULT 0,
      createdAt     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_summaries_session
      ON agent_session_summaries (sessionId, createdAt);

    CREATE TABLE IF NOT EXISTS agent_usage (
      id            TEXT PRIMARY KEY,
      sessionId     TEXT UNIQUE NOT NULL,
      provider      TEXT NOT NULL,
      model         TEXT,
      uncachedInputTokens INTEGER NOT NULL DEFAULT 0,
      cacheCreationInputTokens INTEGER NOT NULL DEFAULT 0,
      cacheReadInputTokens INTEGER NOT NULL DEFAULT 0,
      cacheCreation5mInputTokens INTEGER NOT NULL DEFAULT 0,
      cacheCreation1hInputTokens INTEGER NOT NULL DEFAULT 0,
      inputTokens   INTEGER NOT NULL DEFAULT 0,
      outputTokens  INTEGER NOT NULL DEFAULT 0,
      totalTokens   INTEGER NOT NULL DEFAULT 0,
      estimated     INTEGER NOT NULL DEFAULT 1,
      costEstimated INTEGER NOT NULL DEFAULT 0,
      uncachedInputCost REAL,
      cacheCreationCost REAL,
      cacheReadCost  REAL,
      inputCost     REAL,
      outputCost    REAL,
      totalCost     REAL,
      currency      TEXT,
      createdAt     TEXT NOT NULL,
      updatedAt     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_messages (
      id          TEXT PRIMARY KEY,
      sessionId   TEXT NOT NULL,
      taskId      TEXT,
      role        TEXT NOT NULL,
      type        TEXT NOT NULL,
      content     TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'completed',
      modelId     TEXT,
      metadata    TEXT NOT NULL DEFAULT '{}',
      createdAt   TEXT NOT NULL,
      sequence    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_session_messages_session_sequence
      ON session_messages (sessionId, sequence);

    CREATE TABLE IF NOT EXISTS session_stream_events (
      id          TEXT PRIMARY KEY,
      seq         INTEGER,
      sessionId   TEXT NOT NULL,
      messageId   TEXT,
      eventType   TEXT NOT NULL,
      delta       TEXT,
      payload     TEXT NOT NULL DEFAULT '{}',
      createdAt   TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_session_stream_events_session_seq
      ON session_stream_events (sessionId, seq);

    CREATE TABLE IF NOT EXISTS telegram_chat_settings (
      id                    TEXT PRIMARY KEY,
      chatId                TEXT NOT NULL,
      chatType              TEXT NOT NULL,
      userId                TEXT,
      topicModeEnabled      INTEGER NOT NULL DEFAULT 0,
      defaultDeviceId       TEXT,
      defaultProjectId      TEXT,
      defaultProjectPath    TEXT,
      defaultExecutor       TEXT,
      defaultMode           TEXT,
      defaultPermissionMode TEXT,
      createdAt             TEXT NOT NULL,
      updatedAt             TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_chat_settings_scope
      ON telegram_chat_settings (chatId, chatType, COALESCE(userId, ''));

    CREATE TABLE IF NOT EXISTS telegram_session_bindings (
      id            TEXT PRIMARY KEY,
      chatId        TEXT NOT NULL,
      chatType      TEXT NOT NULL,
      userId        TEXT,
      threadKey     TEXT NOT NULL DEFAULT '',
      sessionId     TEXT NOT NULL,
      topicMode     INTEGER NOT NULL DEFAULT 0,
      metadata      TEXT NOT NULL DEFAULT '{}',
      createdAt     TEXT NOT NULL,
      updatedAt     TEXT NOT NULL,
      lastMessageAt TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_bindings_scope
      ON telegram_session_bindings (chatId, chatType, COALESCE(userId, ''), threadKey);

    CREATE INDEX IF NOT EXISTS idx_telegram_bindings_session
      ON telegram_session_bindings (sessionId);

    CREATE TABLE IF NOT EXISTS telegram_callback_tokens (
      token      TEXT PRIMARY KEY,
      kind       TEXT NOT NULL,
      chatId     TEXT NOT NULL,
      userId     TEXT,
      sessionId  TEXT,
      approvalId TEXT,
      action     TEXT NOT NULL,
      payload    TEXT NOT NULL DEFAULT '{}',
      expiresAt  TEXT NOT NULL,
      resolvedAt TEXT,
      createdAt  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_telegram_callback_tokens_approval
      ON telegram_callback_tokens (approvalId, createdAt);

    CREATE TABLE IF NOT EXISTS telegram_media_attachments (
      id               TEXT PRIMARY KEY,
      sessionId         TEXT,
      messageId         TEXT,
      telegramFileId    TEXT NOT NULL,
      fileUniqueId      TEXT,
      fileName          TEXT,
      mimeType          TEXT,
      fileType          TEXT NOT NULL,
      localPath         TEXT,
      sizeBytes         INTEGER,
      metadata          TEXT NOT NULL DEFAULT '{}',
      createdAt         TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_telegram_media_session
      ON telegram_media_attachments (sessionId, createdAt);

    CREATE TABLE IF NOT EXISTS telegram_gateway_locks (
      name      TEXT PRIMARY KEY,
      keyHash   TEXT NOT NULL,
      ownerId   TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_update_offsets (
      botKey       TEXT PRIMARY KEY,
      lastUpdateId INTEGER NOT NULL,
      updatedAt    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_invocations (
      id           TEXT PRIMARY KEY,
      sessionId    TEXT NOT NULL,
      messageId    TEXT,
      toolName     TEXT NOT NULL,
      arguments    TEXT NOT NULL DEFAULT '{}',
      status       TEXT NOT NULL,
      startedAt    TEXT NOT NULL,
      finishedAt   TEXT,
      summary      TEXT,
      rawOutputRef TEXT
    );
  `);

  ensureColumn(db, 'devices', 'hostVersion', 'TEXT');
  ensureColumn(db, 'devices', 'executors', 'TEXT');
  ensureColumn(db, 'devices', 'workRoot', 'TEXT');
  ensureColumn(db, 'devices', 'workRootExists', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'devices', 'lastHeartbeatAt', 'TEXT');
  ensureColumn(db, 'devices', 'lastBridgeConnectedAt', 'TEXT');
  ensureColumn(db, 'devices', 'lastBridgeDisconnectedAt', 'TEXT');
  ensureColumn(db, 'devices', 'bridgeStatus', 'TEXT');
  ensureColumn(db, 'devices', 'lastDisconnectReason', 'TEXT');
  ensureColumn(db, 'devices', 'workerReconnectCount', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'projects', 'deviceId', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'agent_permission_rules', 'deviceId', 'TEXT');
  rebuildProjectsTableForDeviceScopedPaths(db);
  ensureColumn(db, 'tasks', 'retryCount', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'tasks', 'maxRetries', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'tasks', 'parentTaskId', 'TEXT');
  ensureColumn(db, 'tasks', 'parentGroupId', 'TEXT');
  ensureColumn(db, 'tasks', 'resumeSessionId', 'TEXT');
  ensureColumn(db, 'tasks', 'mode', "TEXT NOT NULL DEFAULT 'agent'");
  ensureColumn(db, 'tasks', 'permissionMode', "TEXT NOT NULL DEFAULT 'default'");
  ensureColumn(db, 'tasks', 'modelId', 'TEXT');
  ensureColumn(db, 'tasks', 'reasoningEffort', 'TEXT');
  ensureColumn(db, 'tasks', 'runtimeOptions', 'TEXT');
  ensureColumn(db, 'task_events', 'seq', 'INTEGER');
  ensureColumn(db, 'approvals', 'timeoutAt', 'TEXT');
  ensureColumn(db, 'approvals', 'commandPreview', 'TEXT');
  ensureColumn(db, 'approvals', 'targetPaths', 'TEXT');
  ensureColumn(db, 'diff_summaries', 'files', 'TEXT');
  ensureColumn(db, 'sessions', 'modelId', 'TEXT');
  ensureColumn(db, 'sessions', 'mode', "TEXT NOT NULL DEFAULT 'agent'");
  ensureColumn(db, 'sessions', 'permissionMode', "TEXT NOT NULL DEFAULT 'default'");
  ensureColumn(db, 'sessions', 'reasoningEffort', 'TEXT');
  ensureColumn(db, 'sessions', 'activeTaskId', 'TEXT');
  ensureColumn(db, 'sessions', 'currentPlan', 'TEXT');
  ensureColumn(db, 'sessions', 'contextClearedAt', 'TEXT');
  ensureColumn(db, 'sessions', 'externalSessionId', 'TEXT');
  ensureColumn(db, 'sessions', 'runtimeOptions', 'TEXT');
  db.exec(`
    UPDATE sessions
    SET mode = CASE currentPlan
      WHEN 'readonly' THEN 'review'
      WHEN 'plan' THEN 'plan'
      ELSE mode
    END
    WHERE mode = 'agent'
      AND currentPlan IN ('readonly', 'plan');
  `);
  ensureColumn(db, 'session_baselines', 'provider', 'TEXT');
  ensureColumn(db, 'agent_usage', 'uncachedInputTokens', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'agent_usage', 'cacheCreationInputTokens', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'agent_usage', 'cacheReadInputTokens', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'agent_usage', 'cacheCreation5mInputTokens', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'agent_usage', 'cacheCreation1hInputTokens', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'agent_usage', 'uncachedInputCost', 'REAL');
  ensureColumn(db, 'agent_usage', 'cacheCreationCost', 'REAL');
  ensureColumn(db, 'agent_usage', 'cacheReadCost', 'REAL');
  ensureColumn(db, 'session_messages', 'taskId', 'TEXT');
  ensureColumn(db, 'session_messages', 'modelId', 'TEXT');
  ensureColumn(db, 'session_messages', 'metadata', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'session_stream_events', 'seq', 'INTEGER');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_task_events_seq
      ON task_events (taskId, seq);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_device_path
      ON projects (deviceId, path);

    CREATE INDEX IF NOT EXISTS idx_projects_device_updated
      ON projects (deviceId, enabled, updatedAt);
  `);
  db.exec(`
    UPDATE task_events
    SET seq = (
      SELECT COUNT(*)
      FROM task_events AS nested
      WHERE nested.taskId = task_events.taskId
        AND nested.rowid <= task_events.rowid
    )
    WHERE seq IS NULL;
  `);
  db.exec(`
    UPDATE session_stream_events
    SET seq = (
      SELECT COUNT(*)
      FROM session_stream_events AS nested
      WHERE nested.sessionId = session_stream_events.sessionId
        AND nested.rowid <= session_stream_events.rowid
    )
    WHERE seq IS NULL;
  `);

  db.exec(`
    INSERT OR IGNORE INTO schema_migrations (id, appliedAt)
    VALUES ('20260507_control_plane_foundation', datetime('now'));

    INSERT OR IGNORE INTO projects (id, deviceId, name, path, gitRemote, defaultBranch, description, enabled, createdAt, updatedAt)
    SELECT
      'project-' || lower(hex(randomblob(16))),
      deviceId,
      workDir,
      workDir,
      NULL,
      NULL,
      'Backfilled from existing task work directory.',
      1,
      MIN(createdAt),
      MAX(createdAt)
    FROM tasks
    WHERE workDir IS NOT NULL AND trim(workDir) <> ''
    GROUP BY deviceId, workDir;

    INSERT OR IGNORE INTO projects (id, deviceId, name, path, gitRemote, defaultBranch, description, enabled, createdAt, updatedAt)
    SELECT
      'project-' || lower(hex(randomblob(16))),
      deviceId,
      workingDirectory,
      workingDirectory,
      NULL,
      NULL,
      'Backfilled from existing agent session working directory.',
      1,
      MIN(createdAt),
      MAX(updatedAt)
    FROM sessions
    WHERE workingDirectory IS NOT NULL AND trim(workingDirectory) <> ''
    GROUP BY deviceId, workingDirectory;

    INSERT OR IGNORE INTO agent_sessions (id, projectId, deviceId, title, status, agentType, provider, model, permissionMode, workingDirectory, createdBy, createdAt, updatedAt, archived, activeRunId, metadata)
    SELECT
      s.id,
      p.id,
      s.deviceId,
      s.title,
      CASE
        WHEN s.status = 'idle' THEN 'completed'
        WHEN s.status = 'interrupted' THEN 'cancelled'
        ELSE s.status
      END,
      s.executorType,
      s.executorType,
      s.modelId,
      s.permissionMode,
      s.workingDirectory,
      s.createdBy,
      s.createdAt,
      s.updatedAt,
      s.archived,
      s.activeTaskId,
      json_object('source', 'sessions')
    FROM sessions s
    LEFT JOIN projects p ON p.deviceId = s.deviceId AND p.path = s.workingDirectory;

    INSERT OR IGNORE INTO agent_runs (id, sessionId, projectId, provider, model, status, prompt, startedAt, finishedAt, createdAt)
    SELECT
      t.id,
      COALESCE(t.parentGroupId, t.resumeSessionId, t.id),
      p.id,
      t.executorType,
      t.modelId,
      CASE
        WHEN t.status = 'cancelled' THEN 'cancelled'
        ELSE t.status
      END,
      t.prompt,
      t.startedAt,
      t.finishedAt,
      t.createdAt
    FROM tasks t
    LEFT JOIN projects p ON p.deviceId = t.deviceId AND p.path = t.workDir;

    UPDATE agent_sessions
    SET projectId = (
      SELECT p.id
      FROM projects p
      WHERE p.deviceId = agent_sessions.deviceId
        AND p.path = agent_sessions.workingDirectory
      LIMIT 1
    )
    WHERE workingDirectory IS NOT NULL
      AND trim(workingDirectory) <> ''
      AND EXISTS (
        SELECT 1
        FROM projects p
        WHERE p.deviceId = agent_sessions.deviceId
          AND p.path = agent_sessions.workingDirectory
      );

    UPDATE agent_runs
    SET projectId = (
      SELECT p.id
      FROM tasks t
      JOIN projects p ON p.deviceId = t.deviceId AND p.path = t.workDir
      WHERE t.id = agent_runs.id
      LIMIT 1
    )
    WHERE EXISTS (
      SELECT 1
      FROM tasks t
      JOIN projects p ON p.deviceId = t.deviceId AND p.path = t.workDir
      WHERE t.id = agent_runs.id
        AND t.workDir IS NOT NULL
        AND trim(t.workDir) <> ''
    );

    INSERT OR IGNORE INTO agent_events (id, seq, sessionId, runId, type, payload, schemaVersion, createdAt)
    SELECT
      e.id,
      NULL,
      COALESCE(t.parentGroupId, t.resumeSessionId, e.taskId),
      e.taskId,
      e.type,
      e.payload,
      1,
      e.createdAt
    FROM task_events e
    LEFT JOIN tasks t ON t.id = e.taskId;

    INSERT OR IGNORE INTO agent_events (id, seq, sessionId, runId, type, payload, schemaVersion, createdAt)
    SELECT
      s.id,
      NULL,
      s.sessionId,
      NULL,
      s.eventType,
      s.payload,
      1,
      s.createdAt
    FROM session_stream_events s;

    INSERT OR IGNORE INTO agent_events (id, seq, sessionId, runId, type, payload, schemaVersion, createdAt)
    SELECT
      'provider-raw-' || r.id,
      NULL,
      r.sessionId,
      r.taskId,
      COALESCE(r.eventType, 'provider.' || r.provider || '.raw'),
      r.payload,
      1,
      r.createdAt
    FROM provider_raw_events r;

    INSERT OR IGNORE INTO agent_approvals (id, sessionId, runId, actionType, riskLevel, reason, status, createdAt, resolvedAt, resolvedBy, timeoutAt, commandPreview, targetPaths)
    SELECT
      a.id,
      COALESCE(t.parentGroupId, t.resumeSessionId, a.taskId),
      a.taskId,
      a.actionType,
      a.riskLevel,
      a.reason,
      a.status,
      a.createdAt,
      a.resolvedAt,
      a.resolvedBy,
      a.timeoutAt,
      a.commandPreview,
      a.targetPaths
    FROM approvals a
    LEFT JOIN tasks t ON t.id = a.taskId;

    INSERT OR IGNORE INTO session_diffs (id, sessionId, runId, filesChanged, insertions, deletions, patchText, files, createdAt)
    SELECT
      d.id,
      COALESCE(t.parentGroupId, t.resumeSessionId, d.taskId),
      d.taskId,
      d.filesChanged,
      d.insertions,
      d.deletions,
      d.patchText,
      d.files,
      d.createdAt
    FROM diff_summaries d
    LEFT JOIN tasks t ON t.id = d.taskId;
  `);

  db.exec(`
    UPDATE agent_events
    SET seq = (
      SELECT COUNT(*)
      FROM agent_events AS nested
      WHERE nested.sessionId = agent_events.sessionId
        AND (
          nested.createdAt < agent_events.createdAt
          OR (
            nested.createdAt = agent_events.createdAt
            AND nested.rowid <= agent_events.rowid
          )
        )
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_events_session_seq_unique
      ON agent_events (sessionId, seq);
  `);

}
