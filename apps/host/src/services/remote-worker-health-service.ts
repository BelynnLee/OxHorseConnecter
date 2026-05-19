import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { DeviceRepository, SecurityAuditRepository } from '@rac/storage';
import { config } from '../config.js';
import { sseManager } from './sse-manager.js';

export class RemoteWorkerHealthService {
  private readonly devices: DeviceRepository;
  private readonly audit: SecurityAuditRepository;
  private timer?: NodeJS.Timeout;

  constructor(
    db: Database.Database,
    private readonly hostDeviceId: string,
  ) {
    this.devices = new DeviceRepository(db);
    this.audit = new SecurityAuditRepository(db);
  }

  start(): void {
    this.resetStaleBridgeState();
    this.timer = setInterval(() => this.markStaleWorkersOffline(), this.checkIntervalMs());
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  markStaleWorkersOffline(nowMs = Date.now()): void {
    const cutoffMs = nowMs - config.remoteWorker.offlineTimeoutMs;
    for (const device of this.devices.findAll()) {
      if (device.id === this.hostDeviceId || device.status !== 'online') continue;
      const heartbeatMs = Date.parse(device.lastSeenAt);
      if (!Number.isFinite(heartbeatMs) || heartbeatMs > cutoffMs) continue;

      const offlineAt = new Date(nowMs).toISOString();
      const updated = this.devices.markWorkerOffline(device.id, 'heartbeat_timeout', offlineAt);
      if (!updated) continue;

      this.audit.create({
        id: uuid(),
        eventType: 'remote.worker_offline',
        severity: 'warn',
        actorType: 'system',
        deviceId: device.id,
        message: `Remote worker "${device.name}" was marked offline after missed heartbeats.`,
        metadata: {
          lastHeartbeatAt: device.lastHeartbeatAt ?? device.lastSeenAt,
          lastSeenAt: device.lastSeenAt,
          offlineTimeoutMs: config.remoteWorker.offlineTimeoutMs,
        },
        createdAt: offlineAt,
      });
      sseManager.broadcastDevice(updated);
    }
  }

  private resetStaleBridgeState(): void {
    const now = new Date().toISOString();
    for (const device of this.devices.findAll()) {
      if (device.id === this.hostDeviceId || device.bridgeStatus === 'disconnected') continue;
      const updated = this.devices.markBridgeDisconnected(device.id, 'host_startup', now);
      if (updated) {
        sseManager.broadcastDevice(updated);
      }
    }
  }

  private checkIntervalMs(): number {
    return Math.max(5_000, Math.min(config.remoteWorker.heartbeatIntervalMs, 30_000));
  }
}
