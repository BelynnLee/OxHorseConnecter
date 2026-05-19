import type Database from 'better-sqlite3';
import type { Device, ExecutorInfo } from '@rac/shared';

interface DeviceRow {
  id: string;
  name: string;
  status: string;
  platform: string;
  lastSeenAt: string;
  createdAt: string;
  fingerprint: string;
  trusted: number;
  hostVersion: string | null;
  executors: string | null;
  workRoot: string | null;
  workRootExists: number | null;
  lastHeartbeatAt: string | null;
  lastBridgeConnectedAt: string | null;
  lastBridgeDisconnectedAt: string | null;
  bridgeStatus: string | null;
  lastDisconnectReason: string | null;
  workerReconnectCount: number | null;
}

function rowToDevice(row: DeviceRow): Device {
  let executors: ExecutorInfo[] | undefined;
  if (row.executors) {
    try {
      executors = JSON.parse(row.executors) as ExecutorInfo[];
    } catch {
      executors = undefined;
    }
  }

  return {
    id: row.id,
    name: row.name,
    status: row.status as Device['status'],
    platform: row.platform,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    fingerprint: row.fingerprint,
    trusted: row.trusted === 1,
    hostVersion: row.hostVersion ?? undefined,
    executors,
    workRoot: row.workRoot ?? undefined,
    workRootExists: row.workRootExists === null ? undefined : row.workRootExists === 1,
    lastHeartbeatAt: row.lastHeartbeatAt ?? undefined,
    lastBridgeConnectedAt: row.lastBridgeConnectedAt ?? undefined,
    lastBridgeDisconnectedAt: row.lastBridgeDisconnectedAt ?? undefined,
    bridgeStatus:
      row.bridgeStatus === 'connected' || row.bridgeStatus === 'disconnected'
        ? row.bridgeStatus
        : undefined,
    lastDisconnectReason: row.lastDisconnectReason ?? undefined,
    workerReconnectCount:
      row.bridgeStatus === 'connected' || row.bridgeStatus === 'disconnected'
        ? row.workerReconnectCount ?? 0
        : undefined,
  };
}

export class DeviceRepository {
  private findAllStmt: Database.Statement;
  private findByIdStmt: Database.Statement;
  private findByFingerprintStmt: Database.Statement;
  private createStmt: Database.Statement;
  private updateStatusStmt: Database.Statement;
  private updateTrustStmt: Database.Statement;
  private updateLastSeenStmt: Database.Statement;
  private updateExecutorsStmt: Database.Statement;
  private updateWorkRootStmt: Database.Statement;
  private updateHeartbeatStmt: Database.Statement;
  private updateBridgeConnectedStmt: Database.Statement;
  private updateBridgeDisconnectedStmt: Database.Statement;
  private markWorkerOfflineStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findAllStmt = db.prepare('SELECT * FROM devices');
    this.findByIdStmt = db.prepare('SELECT * FROM devices WHERE id = ?');
    this.findByFingerprintStmt = db.prepare(
      'SELECT * FROM devices WHERE fingerprint = ?',
    );
    this.createStmt = db.prepare(
      `INSERT INTO devices (
         id, name, status, platform, lastSeenAt, createdAt, fingerprint, trusted,
         hostVersion, executors, workRoot, workRootExists, lastHeartbeatAt,
         lastBridgeConnectedAt, lastBridgeDisconnectedAt, bridgeStatus,
         lastDisconnectReason, workerReconnectCount
       )
       VALUES (
         @id, @name, @status, @platform, @lastSeenAt, @createdAt, @fingerprint, @trusted,
         @hostVersion, @executors, @workRoot, @workRootExists, @lastHeartbeatAt,
         @lastBridgeConnectedAt, @lastBridgeDisconnectedAt, @bridgeStatus,
         @lastDisconnectReason, @workerReconnectCount
       )`,
    );
    this.updateStatusStmt = db.prepare(
      'UPDATE devices SET status = ? WHERE id = ?',
    );
    this.updateTrustStmt = db.prepare(
      'UPDATE devices SET trusted = ? WHERE id = ?',
    );
    this.updateLastSeenStmt = db.prepare(
      'UPDATE devices SET lastSeenAt = ? WHERE id = ?',
    );
    this.updateExecutorsStmt = db.prepare(
      'UPDATE devices SET executors = ? WHERE id = ?',
    );
    this.updateWorkRootStmt = db.prepare(
      'UPDATE devices SET workRoot = ?, workRootExists = ? WHERE id = ?',
    );
    this.updateHeartbeatStmt = db.prepare(
      `UPDATE devices
       SET lastSeenAt = @lastSeenAt,
           lastHeartbeatAt = @lastSeenAt,
           status = @status,
           executors = COALESCE(@executors, executors),
           workRoot = CASE WHEN @workRootSeen = 1 THEN @workRoot ELSE workRoot END,
           workRootExists = CASE WHEN @workRootExistsSeen = 1 THEN @workRootExists ELSE workRootExists END,
           lastDisconnectReason = CASE WHEN @status = 'online' THEN NULL ELSE lastDisconnectReason END
       WHERE id = @id`,
    );
    this.updateBridgeConnectedStmt = db.prepare(
      `UPDATE devices
       SET bridgeStatus = 'connected',
           lastBridgeConnectedAt = @connectedAt,
           lastDisconnectReason = NULL,
           workerReconnectCount = COALESCE(workerReconnectCount, 0) + 1
       WHERE id = @id`,
    );
    this.updateBridgeDisconnectedStmt = db.prepare(
      `UPDATE devices
       SET bridgeStatus = 'disconnected',
           lastBridgeDisconnectedAt = @disconnectedAt,
           lastDisconnectReason = @reason
       WHERE id = @id`,
    );
    this.markWorkerOfflineStmt = db.prepare(
      `UPDATE devices
       SET status = 'offline',
           bridgeStatus = CASE WHEN bridgeStatus IS NULL THEN bridgeStatus ELSE 'disconnected' END,
           lastBridgeDisconnectedAt = CASE WHEN bridgeStatus IS NULL THEN lastBridgeDisconnectedAt ELSE @offlineAt END,
           lastDisconnectReason = @reason
       WHERE id = @id`,
    );
  }

  findAll(): Device[] {
    const rows = this.findAllStmt.all() as DeviceRow[];
    return rows.map(rowToDevice);
  }

  findById(id: string): Device | undefined {
    const row = this.findByIdStmt.get(id) as DeviceRow | undefined;
    return row ? rowToDevice(row) : undefined;
  }

  findByFingerprint(fingerprint: string): Device | undefined {
    const row = this.findByFingerprintStmt.get(fingerprint) as
      | DeviceRow
      | undefined;
    return row ? rowToDevice(row) : undefined;
  }

  create(device: Device): void {
    this.createStmt.run({
      id: device.id,
      name: device.name,
      status: device.status,
      platform: device.platform,
      lastSeenAt: device.lastSeenAt,
      createdAt: device.createdAt,
      fingerprint: device.fingerprint,
      trusted: device.trusted ? 1 : 0,
      hostVersion: device.hostVersion ?? null,
      executors: device.executors ? JSON.stringify(device.executors) : null,
      workRoot: device.workRoot ?? null,
      workRootExists: device.workRootExists ? 1 : 0,
      lastHeartbeatAt: device.lastHeartbeatAt ?? null,
      lastBridgeConnectedAt: device.lastBridgeConnectedAt ?? null,
      lastBridgeDisconnectedAt: device.lastBridgeDisconnectedAt ?? null,
      bridgeStatus: device.bridgeStatus ?? null,
      lastDisconnectReason: device.lastDisconnectReason ?? null,
      workerReconnectCount: device.workerReconnectCount ?? 0,
    });
  }

  updateStatus(id: string, status: string): void {
    this.updateStatusStmt.run(status, id);
  }

  updateTrust(id: string, trusted: boolean): void {
    this.updateTrustStmt.run(trusted ? 1 : 0, id);
  }

  updateLastSeen(id: string): void {
    this.updateLastSeenStmt.run(new Date().toISOString(), id);
  }

  updateExecutors(id: string, executors: ExecutorInfo[]): void {
    this.updateExecutorsStmt.run(JSON.stringify(executors), id);
  }

  updateWorkRoot(id: string, workRoot: string | undefined, workRootExists: boolean | undefined): void {
    this.updateWorkRootStmt.run(workRoot ?? null, workRootExists ? 1 : 0, id);
  }

  updateHeartbeat(
    id: string,
    input: {
      status?: string;
      executors?: ExecutorInfo[];
      workRoot?: string;
      workRootExists?: boolean;
    } = {},
  ): void {
    this.updateHeartbeatStmt.run({
      id,
      lastSeenAt: new Date().toISOString(),
      status: input.status ?? 'online',
      executors: input.executors ? JSON.stringify(input.executors) : null,
      workRootSeen: input.workRoot !== undefined ? 1 : 0,
      workRoot: input.workRoot ?? null,
      workRootExistsSeen: input.workRootExists !== undefined ? 1 : 0,
      workRootExists: input.workRootExists ? 1 : 0,
    });
  }

  markBridgeConnected(id: string, connectedAt = new Date().toISOString()): Device | undefined {
    this.updateBridgeConnectedStmt.run({ id, connectedAt });
    return this.findById(id);
  }

  markBridgeDisconnected(
    id: string,
    reason = 'bridge_disconnected',
    disconnectedAt = new Date().toISOString(),
  ): Device | undefined {
    this.updateBridgeDisconnectedStmt.run({ id, reason, disconnectedAt });
    return this.findById(id);
  }

  markWorkerOffline(
    id: string,
    reason = 'heartbeat_timeout',
    offlineAt = new Date().toISOString(),
  ): Device | undefined {
    this.markWorkerOfflineStmt.run({ id, reason, offlineAt });
    return this.findById(id);
  }
}
