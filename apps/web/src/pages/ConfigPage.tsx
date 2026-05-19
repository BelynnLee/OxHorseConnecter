import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Loader2, RotateCw, Save, Settings2, Shuffle } from 'lucide-react';
import type { ConfigEntry, ConfigFileState, UpdateConfigInput } from '../types.ts';
import { getConfigFile, getHealth, restartHostService, updateConfigFile } from '../api.ts';
import { Button } from '../components/ui/Button.tsx';
import { LoadingState } from '../components/ui/LoadingState.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { SectionHeader, SectionPanel } from '../components/ui/SectionPanel.tsx';
import { StatusBanner } from '../components/ui/StatusBanner.tsx';
import DirPicker from '../components/DirPicker.tsx';
import { getErrorMessage } from '../lib/format.ts';
import { useT } from '../i18n/index.ts';
import { useLatestRef } from '../hooks/useLatestRef.ts';

const GROUP_ORDER: ConfigEntry['group'][] = [
  'host',
  'web',
  'security',
  'logging',
  'auth',
  'task',
  'remote',
  'executors',
  'runtime',
  'providers',
  'notifications',
];

type ConfigFieldText = { label: string; description: string };
type ConfigWarningCode = ConfigFileState['warnings'][number]['code'];

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function buildForm(entries: ConfigEntry[]): Record<string, string> {
  return Object.fromEntries(
    entries.map((entry) => [entry.key, entry.secret ? '' : (entry.value ?? '')])
  );
}

function entryInputType(entry: ConfigEntry): string {
  if (entry.kind === 'number') return 'number';
  if (entry.kind === 'url') return 'url';
  return 'text';
}

function restartTargetLabel(entry: ConfigEntry): string | undefined {
  if (!entry.restartRequired) return undefined;
  if (entry.restartTarget === 'web') return 'web restart';
  if (entry.restartTarget === 'worker') return 'worker restart';
  return 'host restart';
}

function FieldRow({
  entry,
  value,
  secretTouched,
  secretRevealed,
  onChange,
  onToggleSecret,
}: {
  entry: ConfigEntry;
  value: string;
  secretTouched: boolean;
  secretRevealed: boolean;
  onChange: (value: string, touched?: boolean) => void;
  onToggleSecret: () => void;
}) {
  const { t } = useT();
  const fieldText = (t.config.fields as Partial<Record<string, ConfigFieldText>>)[entry.key] ?? {
    label: entry.label,
    description: entry.description,
  };
  const sourceLabel = {
    file: t.config.sourceFile,
    environment: t.config.sourceEnvironment,
    default: t.config.sourceDefault,
  }[entry.source];
  const restartLabel = restartTargetLabel(entry);

  return (
    <div className="grid gap-3 border-t border-border-soft py-4 first:border-t-0 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={entry.key} className="text-sm font-semibold text-text-primary">
            {fieldText.label}
          </label>
          <span className="rounded-xs bg-bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-text-tertiary">
            {entry.key}
          </span>
          {entry.required && (
            <span className="rounded-xs bg-warning-soft px-1.5 py-0.5 text-xs text-warning">
              {t.config.required}
            </span>
          )}
          {entry.secret && (
            <span className="rounded-xs bg-bg-surface-3 px-1.5 py-0.5 text-xs text-text-tertiary">
              {entry.configured ? t.config.configured : t.config.notConfigured}
            </span>
          )}
          {entry.source !== 'default' && (
            <span className="rounded-xs bg-bg-surface-3 px-1.5 py-0.5 text-xs text-text-tertiary">
              {sourceLabel}
            </span>
          )}
          {entry.advanced && (
            <span className="rounded-xs bg-bg-surface-3 px-1.5 py-0.5 text-xs text-text-tertiary">
              advanced
            </span>
          )}
          {restartLabel && (
            <span className="rounded-xs bg-info-soft px-1.5 py-0.5 text-xs text-info">
              {restartLabel}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-text-tertiary">{fieldText.description}</p>
      </div>

      <div>
        {entry.kind === 'boolean' ? (
          <select
            id={entry.key}
            value={value}
            disabled={entry.readOnly}
            onChange={(event) => onChange(event.target.value)}
            className="input-base"
          >
            {!entry.required && <option value="">Default</option>}
            <option value="true">{t.yes}</option>
            <option value="false">{t.no}</option>
          </select>
        ) : entry.kind === 'select' ? (
          <select
            id={entry.key}
            value={value}
            disabled={entry.readOnly}
            onChange={(event) => onChange(event.target.value)}
            className="input-base"
          >
            {!entry.required && <option value="">Default</option>}
            {entry.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : entry.kind === 'csv' || entry.kind === 'json' ? (
          <textarea
            id={entry.key}
            rows={entry.kind === 'json' ? 4 : 2}
            value={value}
            disabled={entry.readOnly}
            onChange={(event) => onChange(event.target.value)}
            placeholder={entry.placeholder}
            className="input-base resize-none font-mono text-sm"
          />
        ) : entry.kind === 'directory' ? (
          <DirPicker
            value={value}
            onChange={(next) => onChange(next)}
            disabled={entry.readOnly}
            placeholder={entry.placeholder}
            showBrowseLabel
            className="min-w-0"
            inputClassName="input-base pr-8 font-mono text-sm"
          />
        ) : (
          <>
            <div className="flex gap-2">
              <input
                id={entry.key}
                type={entry.secret && !secretRevealed ? 'password' : entryInputType(entry)}
                value={value}
                disabled={entry.readOnly}
                onChange={(event) => onChange(event.target.value, entry.secret)}
                placeholder={
                  entry.secret && entry.configured && !secretTouched
                    ? t.config.keepSecret
                    : entry.placeholder
                }
                className="input-base font-mono text-sm"
              />
              {entry.secret && (
                <button
                  type="button"
                  onClick={onToggleSecret}
                  disabled={!value}
                  className="btn-secondary flex-shrink-0 px-3 text-sm"
                >
                  {secretRevealed ? t.config.hideSecret : t.config.showSecret}
                </button>
              )}
            </div>
            {entry.secret && secretTouched && value.trim() && (
              <p className="mt-1 text-xs text-warning">{t.config.newSecretValue}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ConfigPage() {
  const { t } = useT();
  const tRef = useLatestRef(t);
  const [config, setConfig] = useState<ConfigFileState | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [secretTouched, setSecretTouched] = useState<Record<string, boolean>>({});
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartPending, setRestartPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void getConfigFile()
      .then((state) => {
        if (cancelled) return;
        setConfig(state);
        setForm(buildForm(state.entries));
        setSecretTouched({});
        setRevealedSecrets({});
      })
      .catch((err) => {
        if (!cancelled) {
          setError(getErrorMessage(err, tRef.current.config.errorLoad));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tRef]);

  const groupedEntries = useMemo(() => {
    if (!config) return [];
    return GROUP_ORDER.map((group) => ({
      group,
      entries: config.entries.filter((entry) => entry.group === group),
    })).filter((group) => group.entries.length > 0);
  }, [config]);

  function updateField(key: string, value: string, touched = false) {
    setForm((current) => ({ ...current, [key]: value }));
    if (touched) {
      setSecretTouched((current) => ({ ...current, [key]: true }));
    }
  }

  function toggleSecret(key: string) {
    setRevealedSecrets((current) => ({ ...current, [key]: !current[key] }));
  }

  function fillRecommendedSecrets() {
    if (!config) return;
    const generated: Record<string, string> = {};
    const jwt = config.entries.find((entry) => entry.key === 'JWT_SECRET');

    if (jwt && !jwt.configured && !(form.JWT_SECRET ?? '').trim()) {
      generated.JWT_SECRET = randomHex(48);
    }

    const remoteRegistration = config.entries.find(
      (entry) => entry.key === 'REMOTE_REGISTRATION_TOKEN'
    );
    if (
      remoteRegistration &&
      !remoteRegistration.configured &&
      !(form.REMOTE_REGISTRATION_TOKEN ?? '').trim()
    ) {
      generated.REMOTE_REGISTRATION_TOKEN = randomHex(48);
    }

    const providerSecretKey = config.entries.find((entry) => entry.key === 'PROVIDER_SECRET_KEY');
    if (
      providerSecretKey &&
      !providerSecretKey.configured &&
      !(form.PROVIDER_SECRET_KEY ?? '').trim()
    ) {
      generated.PROVIDER_SECRET_KEY = randomHex(48);
    }

    const generatedKeys = Object.keys(generated);
    if (generatedKeys.length === 0) {
      setMessage(t.config.noMissingSecrets);
      setError('');
      return;
    }

    const generatedState = Object.fromEntries(generatedKeys.map((key) => [key, true]));
    setForm((current) => ({ ...current, ...generated }));
    setSecretTouched((current) => ({ ...current, ...generatedState }));
    setRevealedSecrets((current) => ({ ...current, ...generatedState }));
    setMessage(t.config.generatedMessage);
    setError('');
  }

  function buildUpdates(): UpdateConfigInput['updates'] {
    if (!config) return [];
    const updates: UpdateConfigInput['updates'] = [];

    for (const entry of config.entries) {
      if (entry.readOnly) continue;
      const value = form[entry.key] ?? '';
      if (entry.secret) {
        if (!secretTouched[entry.key] || !value.trim()) {
          continue;
        }
        updates.push({ key: entry.key, value });
        continue;
      }

      const original = entry.value ?? '';
      const shouldWriteDefault = !config.exists && value.trim() !== '';
      if (!shouldWriteDefault && value === original) {
        continue;
      }
      updates.push({ key: entry.key, value: value.trim() ? value : null });
    }

    return updates;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!config) return;

    const updates = buildUpdates();
    setMessage('');
    setError('');
    if (updates.length === 0) {
      setMessage(t.config.noChanges);
      return;
    }

    setSaving(true);
    try {
      const updated = await updateConfigFile({ updates });
      setConfig(updated);
      setForm(buildForm(updated.entries));
      setSecretTouched({});
      setRevealedSecrets({});
      setRestartPending(true);
      setMessage(t.config.savedMessage);
    } catch (err) {
      setError(getErrorMessage(err, t.config.errorSave));
    } finally {
      setSaving(false);
    }
  }

  async function waitForHostReady(): Promise<boolean> {
    await sleep(1500);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await getHealth();
        return true;
      } catch {
        await sleep(1000);
      }
    }
    return false;
  }

  async function handleRestart() {
    if (!window.confirm(t.config.restartConfirm)) {
      return;
    }

    setRestarting(true);
    setMessage(t.config.restartingMessage);
    setError('');

    try {
      await restartHostService();
      const ready = await waitForHostReady();
      if (!ready) {
        setError(t.config.restartTimeout);
        return;
      }
      setMessage(t.config.restartReady);
      window.setTimeout(() => {
        window.location.reload();
      }, 600);
    } catch (err) {
      setError(getErrorMessage(err, t.config.errorRestart));
    } finally {
      setRestarting(false);
    }
  }

  if (loading) {
    return <LoadingState label={t.config.loading} />;
  }

  return (
    <div className="page-shell">
      <PageHeader
        icon={<Settings2 className="h-4 w-4" />}
        title={t.config.title}
        subtitle={t.config.subtitle}
        className="flex-shrink-0"
        actions={
          config ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setForm(buildForm(config.entries));
                  setSecretTouched({});
                  setRevealedSecrets({});
                  setMessage('');
                  setError('');
                }}
              >
                {t.config.reset}
              </Button>
              <Button form="config-page-form" type="submit" disabled={saving || restarting} variant="primary">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {!saving && <Save className="h-4 w-4" />}
                {saving ? t.config.saving : t.config.save}
              </Button>
              <Button
                type="button"
                disabled={saving || restarting}
                onClick={() => void handleRestart()}
                variant="secondary"
              >
                {restarting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCw className="h-4 w-4" />
                )}
                {restarting ? t.config.restarting : t.config.restartHost}
              </Button>
            </div>
          ) : null
        }
      />

      {error ? (
        <StatusBanner tone="error" message={error} className="flex-shrink-0" />
      ) : message ? (
        <StatusBanner tone="success" message={message} className="flex-shrink-0" />
      ) : null}

      {config && (
        <form id="config-page-form" onSubmit={handleSubmit} className="scroll-area space-y-4 pb-2">
          <SectionPanel>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary">
                  {config.exists ? t.config.fileExists : t.config.fileMissing}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-text-tertiary">{config.path}</p>
              </div>
              <Button type="button" onClick={fillRecommendedSecrets} variant="secondary">
                <Shuffle className="h-4 w-4" />
                {t.config.generateSecrets}
              </Button>
            </div>
            <div className="mt-3 rounded-sm border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
              {t.config.restartNote}
            </div>
            {restartPending && (
              <div className="mt-3 rounded-sm border border-info/30 bg-info-soft px-3 py-2 text-sm text-info">
                {t.config.restartPending}
              </div>
            )}
            <p className="mt-3 text-sm text-text-tertiary">{t.config.secretNote}</p>
            {config.warnings.length > 0 && (
              <div className="mt-3 space-y-2">
                {config.warnings.map((warning) => (
                  <div
                    key={warning.code}
                    className="rounded-sm border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
                  >
                    {(t.config.warnings as Partial<Record<ConfigWarningCode, string>>)[warning.code] ?? warning.message}
                  </div>
                ))}
              </div>
            )}
          </SectionPanel>

          {groupedEntries.map(({ group, entries }) => {
            const regularEntries = entries.filter((entry) => !entry.advanced);
            const advancedEntries = entries.filter((entry) => entry.advanced);
            return (
              <SectionPanel key={group}>
                <SectionHeader title={t.config.groups[group]} subtitle={t.config.groupHints[group]} />
                {regularEntries.map((entry) => (
                  <FieldRow
                    key={entry.key}
                    entry={entry}
                    value={form[entry.key] ?? ''}
                    secretTouched={Boolean(secretTouched[entry.key])}
                    secretRevealed={Boolean(revealedSecrets[entry.key])}
                    onChange={(value, touched) => updateField(entry.key, value, touched)}
                    onToggleSecret={() => toggleSecret(entry.key)}
                  />
                ))}
                {advancedEntries.length > 0 && (
                  <details className="border-t border-border-soft py-3">
                    <summary className="cursor-pointer text-sm font-semibold text-text-secondary">
                      Advanced fields
                    </summary>
                    <div className="mt-2">
                      {advancedEntries.map((entry) => (
                        <FieldRow
                          key={entry.key}
                          entry={entry}
                          value={form[entry.key] ?? ''}
                          secretTouched={Boolean(secretTouched[entry.key])}
                          secretRevealed={Boolean(revealedSecrets[entry.key])}
                          onChange={(value, touched) => updateField(entry.key, value, touched)}
                          onToggleSecret={() => toggleSecret(entry.key)}
                        />
                      ))}
                    </div>
                  </details>
                )}
              </SectionPanel>
            );
          })}

        </form>
      )}
    </div>
  );
}
