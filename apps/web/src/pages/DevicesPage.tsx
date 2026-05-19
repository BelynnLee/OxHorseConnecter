import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Cpu, Monitor, RefreshCw, ShieldCheck, ShieldOff, Terminal } from 'lucide-react';
import { Badge } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { LoadingState } from '../components/ui/LoadingState.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { SectionPanel } from '../components/ui/SectionPanel.tsx';
import { StatCard } from '../components/ui/StatCard.tsx';
import { StatusBanner } from '../components/ui/StatusBanner.tsx';
import { SurfaceItem } from '../components/ui/SurfaceItem.tsx';
import type { Device, DeviceCredential, ExecutorInfo } from '../types.ts';
import {
  createDeviceCredential,
  getDeviceCredentials,
  getDevices,
  probeExecutors,
  revokeDeviceCredential,
  trustDevice,
  untrustDevice,
} from '../api.ts';
import { formatRelativeTime, getErrorMessage } from '../lib/format.ts';
import { useT } from '../i18n/index.ts';
import { useLatestRef } from '../hooks/useLatestRef.ts';

function extractVersionNumber(raw: string): string {
  return raw.match(/\d[\d.\-a-z]*/i)?.[0] ?? raw;
}

function shortDeviceId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

const EXECUTOR_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  claude: 'Claude API',
  mock: 'Mock',
};

function ExecutorBadges({
  executors,
  t,
}: {
  executors: ExecutorInfo[];
  t: ReturnType<typeof useT>['t'];
}) {
  const visible = executors.filter((e) => e.type !== 'mock');
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {visible.map((info) => (
        <span
          key={info.type}
          title={info.version ?? (info.available ? t.devices.available : t.devices.notDetected)}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-pill border ${
            info.available
              ? 'bg-info-soft border-info/30 text-info'
              : 'bg-bg-surface-3 border-border-default text-text-disabled'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${info.available ? 'bg-info' : 'bg-text-disabled'}`}
          />
          {EXECUTOR_LABELS[info.type] ?? info.type}
          {info.version && info.available ? (
            <span className="opacity-60 font-normal">{extractVersionNumber(info.version)}</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

export default function DevicesPage() {
  const { t, locale } = useT();
  const tRef = useLatestRef(t);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [probingId, setProbingId] = useState<string | null>(null);
  const [credentialsByDevice, setCredentialsByDevice] = useState<
    Record<string, DeviceCredential[]>
  >({});
  const [issuedTokens, setIssuedTokens] = useState<Record<string, string>>({});
  const [credentialBusyId, setCredentialBusyId] = useState<string | null>(null);

  const refreshCredentials = useCallback(async (items: Device[]) => {
    const pairs = await Promise.all(
      items.map(async (device) => {
        try {
          return [device.id, await getDeviceCredentials(device.id)] as const;
        } catch {
          return [device.id, []] as const;
        }
      })
    );
    setCredentialsByDevice(Object.fromEntries(pairs));
  }, []);

  const fetchDevices = useCallback(async () => {
    try {
      const data = await getDevices();
      setDevices(data);
      void refreshCredentials(data);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, tRef.current.devices.errorLoad));
    } finally {
      setLoading(false);
    }
  }, [refreshCredentials, tRef]);

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 10_000);
    return () => clearInterval(interval);
  }, [fetchDevices]);

  async function handleToggleTrust(device: Device) {
    try {
      const updated = device.trusted
        ? await untrustDevice(device.id)
        : await trustDevice(device.id);
      setDevices((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    } catch (err) {
      setError(getErrorMessage(err, t.devices.errorUpdate));
    }
  }

  async function handleProbe(device: Device) {
    setProbingId(device.id);
    try {
      const executors = await probeExecutors();
      setDevices((prev) => prev.map((d) => (d.id === device.id ? { ...d, executors } : d)));
    } catch (err) {
      setError(getErrorMessage(err, t.devices.errorProbe));
    } finally {
      setProbingId(null);
    }
  }

  async function handleCreateCredential(device: Device) {
    setCredentialBusyId(`create:${device.id}`);
    setError('');
    try {
      const issued = await createDeviceCredential(device.id, {
        name: t.devices.credentialWorkerName(device.name),
      });
      setIssuedTokens((current) => ({ ...current, [device.id]: issued.token }));
      setCredentialsByDevice((current) => ({
        ...current,
        [device.id]: [issued.credential, ...(current[device.id] ?? [])],
      }));
    } catch (err) {
      setError(getErrorMessage(err, t.devices.errorCreateCredential));
    } finally {
      setCredentialBusyId(null);
    }
  }

  async function handleRevokeCredential(device: Device, credential: DeviceCredential) {
    setCredentialBusyId(`revoke:${credential.id}`);
    setError('');
    try {
      const updated = await revokeDeviceCredential(device.id, credential.id);
      setCredentialsByDevice((current) => ({ ...current, [device.id]: updated }));
    } catch (err) {
      setError(getErrorMessage(err, t.devices.errorRevokeCredential));
    } finally {
      setCredentialBusyId(null);
    }
  }

  const onlineCount = devices.filter((d) => d.status === 'online').length;
  const trustedCount = devices.filter((d) => d.trusted).length;
  const executorCount = devices.reduce(
    (count, device) =>
      count + (device.executors?.filter((executor) => executor.available).length ?? 0),
    0
  );

  return (
    <div className="page-shell">
      <PageHeader
        title={t.devices.title}
        subtitle={
          !loading && devices.length > 0
            ? t.devices.onlineSummary(onlineCount, devices.length)
            : undefined
        }
        className="flex-shrink-0"
        actions={
          <Button onClick={fetchDevices} variant="ghost" className="text-sm">
            <RefreshCw className="h-4 w-4" />
            {t.refresh}
          </Button>
        }
      />

      {!loading && devices.length > 0 && (
        <div className="grid flex-shrink-0 gap-3 sm:grid-cols-3">
          <StatCard
            label={t.devices.online}
            value={onlineCount}
            icon={<Monitor className="h-5 w-5 text-info" />}
          />
          <StatCard
            label={t.devices.trusted}
            value={trustedCount}
            icon={<ShieldCheck className="h-5 w-5 text-success" />}
          />
          <StatCard
            label={t.devices.executorsTitle}
            value={executorCount}
            icon={<Cpu className="h-5 w-5 text-accent" />}
          />
        </div>
      )}

      <StatusBanner tone="error" message={error} className="flex-shrink-0" />

      <div className="scroll-area">
        {loading ? (
          <LoadingState label={t.devices.loading} className="h-full flex-none" />
        ) : devices.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<Monitor className="h-6 w-6" />}
              title={t.devices.noDevices}
              description={t.devices.connectHint}
              className="border-none bg-transparent"
            />
          </div>
        ) : (
          <div className="grid gap-3 pb-2 xl:grid-cols-2">
            {devices.map((device) => (
              <SectionPanel
                key={device.id}
                className="flex flex-col gap-3 transition-colors duration-140 hover:border-border-strong"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center border border-border-default bg-bg-surface-3 text-text-tertiary">
                      <Terminal className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-text-primary">{device.name}</h2>
                      <p className="font-mono text-xs text-text-tertiary">
                        {shortDeviceId(device.id)}
                      </p>
                    </div>
                  </div>
                  <Badge
                    tone={device.status === 'online' ? 'success' : 'muted'}
                    className="flex-shrink-0"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${device.status === 'online' ? 'bg-success' : 'bg-text-tertiary'}`}
                    />
                    {device.status === 'online' ? t.devices.online : t.devices.offline}
                  </Badge>
                </div>

                <div className="space-y-1 text-sm flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-text-tertiary">{t.devices.platform}</span>
                    <span className="text-text-secondary font-mono text-xs">{device.platform}</span>
                  </div>
                  {device.hostVersion && (
                    <div className="flex items-center justify-between">
                      <span className="text-text-tertiary">{t.devices.version}</span>
                      <span className="text-text-disabled text-xs font-mono">
                        v{device.hostVersion}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-text-tertiary">{t.devices.lastSeen}</span>
                    <span className="text-text-secondary text-xs">
                      {formatRelativeTime(device.lastSeenAt, locale)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-text-tertiary">Last heartbeat</span>
                    <span className="text-text-secondary text-xs">
                      {device.lastHeartbeatAt ? formatRelativeTime(device.lastHeartbeatAt, locale) : 'not reported'}
                    </span>
                  </div>
                  {device.bridgeStatus && (
                    <div className="flex items-center justify-between">
                      <span className="text-text-tertiary">Workspace bridge</span>
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium ${
                          device.bridgeStatus === 'connected' ? 'text-success' : 'text-danger'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            device.bridgeStatus === 'connected' ? 'bg-success' : 'bg-danger'
                          }`}
                        />
                        {device.bridgeStatus}
                      </span>
                    </div>
                  )}
                  {device.lastBridgeDisconnectedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-text-tertiary">Bridge disconnected</span>
                      <span className="text-text-secondary text-xs">
                        {formatRelativeTime(device.lastBridgeDisconnectedAt, locale)}
                      </span>
                    </div>
                  )}
                  {device.lastDisconnectReason && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-text-tertiary">Disconnect reason</span>
                      <span className="min-w-0 truncate text-right text-xs text-danger">
                        {device.lastDisconnectReason}
                      </span>
                    </div>
                  )}
                  {device.workerReconnectCount !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-text-tertiary">Bridge reconnects</span>
                      <span className="text-text-secondary text-xs">
                        {device.workerReconnectCount}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-text-tertiary">{t.devices.trusted}</span>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium ${device.trusted ? 'text-success' : 'text-text-disabled'}`}
                    >
                      {device.trusted ? (
                        <ShieldCheck className="h-3 w-3" />
                      ) : (
                        <ShieldOff className="h-3 w-3" />
                      )}
                      {device.trusted ? t.yes : t.no}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-text-tertiary">Workspace root</span>
                    <span
                      className={`min-w-0 break-all text-right font-mono text-[11px] ${
                        device.workRoot && device.workRootExists !== false
                          ? 'text-text-secondary'
                          : 'text-danger'
                      }`}
                    >
                      {device.workRoot
                        ? `${device.workRoot}${device.workRootExists === false ? ' (missing)' : ''}`
                        : 'not reported'}
                    </span>
                  </div>
                </div>

                {device.executors && device.executors.length > 0 && (
                  <div>
                    <p className="text-xs text-text-tertiary mb-1">{t.devices.executorsTitle}</p>
                    <ExecutorBadges executors={device.executors} t={t} />
                  </div>
                )}

                <div className="border-t border-border-soft pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-normal text-text-tertiary">
                      {t.devices.credentials}
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleCreateCredential(device)}
                      disabled={credentialBusyId === `create:${device.id}`}
                      className="text-xs font-medium px-2.5 py-1 rounded-xs bg-bg-surface-3 text-text-secondary hover:bg-bg-surface-1 disabled:opacity-50 transition-colors duration-140"
                    >
                      {t.devices.issueCredential}
                    </button>
                  </div>
                  {issuedTokens[device.id] && (
                    <div className="mt-2 rounded-xs border border-warning/30 bg-warning-soft px-2 py-2">
                      <p className="text-xs font-medium text-warning">{t.devices.newToken}</p>
                      <p className="mt-1 break-all font-mono text-[11px] leading-4 text-text-secondary">
                        {issuedTokens[device.id]}
                      </p>
                    </div>
                  )}
                  <div className="mt-2 space-y-1.5">
                    {(credentialsByDevice[device.id] ?? []).slice(0, 4).map((credential) => (
                      <SurfaceItem
                        key={credential.id}
                        className="flex items-center justify-between gap-2 px-2 py-1.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-text-secondary">
                            {credential.name ?? credential.tokenPrefix}
                          </p>
                          <p className="font-mono text-[11px] text-text-tertiary">
                            {credential.tokenPrefix} -{' '}
                            {credential.revokedAt
                              ? t.devices.credentialRevoked
                              : credential.lastUsedAt
                                ? formatRelativeTime(credential.lastUsedAt, locale)
                                : t.devices.credentialUnused}
                          </p>
                        </div>
                        {!credential.revokedAt && (
                          <button
                            type="button"
                            onClick={() => void handleRevokeCredential(device, credential)}
                            disabled={credentialBusyId === `revoke:${credential.id}`}
                            className="flex-shrink-0 text-xs font-medium text-danger hover:text-danger"
                          >
                            {t.devices.revokeCredential}
                          </button>
                        )}
                      </SurfaceItem>
                    ))}
                    {(credentialsByDevice[device.id] ?? []).length === 0 && (
                      <p className="text-xs text-text-tertiary">{t.devices.noCredentials}</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border-soft">
                  <Button
                    onClick={() => handleToggleTrust(device)}
                    variant={device.trusted ? 'danger' : 'secondary'}
                    size="sm"
                  >
                    {device.trusted ? t.devices.untrust : t.devices.trust}
                  </Button>
                  {device.status === 'online' && (
                    <Button
                      onClick={() => handleProbe(device)}
                      disabled={probingId === device.id}
                      variant="outline"
                      size="sm"
                    >
                      {probingId === device.id ? t.devices.probing : t.devices.probeTools}
                    </Button>
                  )}
                  {device.status === 'online' && device.trusted && (
                    <Link
                      to={`/workbench?deviceId=${device.id}`}
                      className="inline-flex h-8 items-center justify-center gap-2 rounded-xs border border-accent/35 bg-accent-soft px-3 text-xs font-medium text-accent transition-colors duration-140 hover:bg-accent/20"
                    >
                      <Bot className="h-3.5 w-3.5" />
                      {t.devices.createTask}
                    </Link>
                  )}
                </div>
              </SectionPanel>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
