import { useEffect, useState, type FormEvent } from 'react';
import { Bell, Loader2, RefreshCw, Save, Settings2, ShieldCheck, Webhook } from 'lucide-react';
import type { NotificationSettings, SecurityAuditEvent } from '../types.ts';
import {
  getNotificationSettings,
  getSecurityAudit,
  testTelegram,
  testWebhook,
  updateNotificationSettings,
} from '../api.ts';
import { Button } from '../components/ui/Button.tsx';
import { FormField } from '../components/ui/FormField.tsx';
import { LoadingState } from '../components/ui/LoadingState.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { SectionHeader, SectionPanel } from '../components/ui/SectionPanel.tsx';
import { StatusBanner } from '../components/ui/StatusBanner.tsx';
import { SurfaceItem } from '../components/ui/SurfaceItem.tsx';
import { useAsyncAction } from '../hooks/useAsyncAction.ts';
import { usePushNotify } from '../hooks/usePushNotify.ts';
import { useT } from '../i18n/index.ts';
import { formatDateTime, getErrorMessage } from '../lib/format.ts';

interface SettingsForm {
  webhookUrl: string;
  webhookSecret: string;
  telegramChatId: string;
  approvalTimeoutSeconds: number;
}

function createForm(settings?: NotificationSettings): SettingsForm {
  return {
    webhookUrl: settings?.webhookUrl ?? '',
    webhookSecret: '',
    telegramChatId: settings?.telegramChatId ?? '',
    approvalTimeoutSeconds: settings?.approvalTimeoutSeconds ?? 120,
  };
}

export default function SettingsPage() {
  const { t } = useT();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [form, setForm] = useState<SettingsForm>(createForm());
  const [loading, setLoading] = useState(true);
  const [auditEvents, setAuditEvents] = useState<SecurityAuditEvent[]>([]);
  const action = useAsyncAction();
  const push = usePushNotify(settings?.webPushPublicKey);

  const isSaving = action.busy === 'save';
  const isTestingWebhook = action.busy === 'webhook';
  const isTestingTelegram = action.busy === 'telegram';
  const isAuditLoading = action.busy === 'audit';

  async function refreshSettings() {
    const s = await getNotificationSettings();
    setSettings(s);
    setForm(createForm(s));
  }

  useEffect(() => {
    let cancelled = false;
    void getNotificationSettings()
      .then((s) => {
        if (!cancelled) {
          setSettings(s);
          setForm(createForm(s));
        }
      })
      .catch((err) => {
        if (!cancelled) action.setError(getErrorMessage(err, t.settings.errorLoad));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    void getSecurityAudit({ limit: 30 })
      .then((events) => {
        if (!cancelled) setAuditEvents(events);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only fetch
  }, []);

  async function handleRefreshAudit() {
    await action.run(
      'audit',
      async () => {
        setAuditEvents(await getSecurityAudit({ limit: 30 }));
      },
      { errorFallback: t.settings.errorSecurityAudit }
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await action.run(
      'save',
      async () => {
        const updated = await updateNotificationSettings({
          webhookUrl: form.webhookUrl.trim() || null,
          webhookSecret: form.webhookSecret.trim() || undefined,
          telegramChatId: form.telegramChatId.trim() || null,
          approvalTimeoutSeconds: form.approvalTimeoutSeconds,
        });
        setSettings(updated);
        setForm(createForm(updated));
      },
      { successMessage: t.settings.savedMessage, errorFallback: t.settings.errorSave }
    );
  }

  async function handleWebhookTest() {
    await action.run('webhook', testWebhook, {
      successMessage: t.settings.webhookTestSent,
      errorFallback: t.settings.errorWebhookTest,
    });
  }

  async function handleTelegramTest() {
    await action.run('telegram', testTelegram, {
      successMessage: t.settings.telegramTestSent,
      errorFallback: t.settings.errorTelegramTest,
    });
  }

  async function handlePushSubscribe() {
    await action.run(
      'push:sub',
      async () => {
        await push.subscribe();
        await refreshSettings();
      },
      {
        successMessage: t.settings.pushSubscribed,
        errorFallback: push.error || t.settings.errorSubscribe,
      }
    );
  }

  async function handlePushUnsubscribe() {
    await action.run('push:unsub', () => push.unsubscribe(), {
      successMessage: t.settings.pushUnsubscribed,
      errorFallback: push.error || t.settings.errorUnsubscribe,
    });
  }

  if (loading) {
    return <LoadingState label={t.settings.loading} />;
  }

  return (
    <div className="page-shell">
      <PageHeader
        icon={<Settings2 className="h-4 w-4" />}
        title={t.settings.title}
        subtitle={t.settings.subtitle}
        className="flex-shrink-0"
        actions={
          <Button form="settings-page-form" type="submit" disabled={isSaving} variant="primary">
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {isSaving ? t.settings.saving : t.settings.saveSettings}
          </Button>
        }
      />

      {action.error ? (
        <StatusBanner tone="error" message={action.error} className="flex-shrink-0" />
      ) : action.notice ? (
        <StatusBanner tone="success" message={action.notice} className="flex-shrink-0" />
      ) : null}

      <div className="scroll-area space-y-4 pb-2">
        <SectionPanel>
          <SectionHeader
            icon={<ShieldCheck className="h-4 w-4" />}
            title={t.settings.securityAuditTitle}
            subtitle={t.settings.securityAuditSubtitle}
            actions={
              <Button
                type="button"
                onClick={() => void handleRefreshAudit()}
                disabled={isAuditLoading}
                variant="secondary"
                size="sm"
              >
                {isAuditLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {isAuditLoading ? t.settings.working : t.refresh}
              </Button>
            }
          />
          <div className="space-y-2">
            {auditEvents.slice(0, 10).map((event) => (
              <SurfaceItem key={event.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-primary">
                      {event.eventType}
                    </p>
                    <p className="mt-0.5 text-xs text-text-tertiary">
                      {event.actorType}
                      {event.actorId ? `:${event.actorId}` : ''} - {formatDateTime(event.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`rounded-xs px-1.5 py-0.5 text-xs ${
                      event.severity === 'error' || event.severity === 'critical'
                        ? 'bg-danger-soft text-danger'
                        : event.severity === 'warn'
                          ? 'bg-warning-soft text-warning'
                          : 'bg-bg-surface-3 text-text-tertiary'
                    }`}
                  >
                    {event.severity}
                  </span>
                </div>
                <p className="mt-1 text-sm text-text-secondary">{event.message}</p>
              </SurfaceItem>
            ))}
            {auditEvents.length === 0 && (
              <p className="text-sm text-text-tertiary">{t.settings.noAuditEvents}</p>
            )}
          </div>
        </SectionPanel>

        <form
          id="settings-page-form"
          onSubmit={handleSubmit}
          className="bg-bg-surface-2 border border-border-default rounded-sm p-4 space-y-5"
        >
          <div>
            <SectionHeader
              icon={<Webhook className="h-4 w-4" />}
              title={t.settings.webhookTitle}
              subtitle={t.settings.webhookSubtitle}
            />
            <div className="space-y-3">
              <FormField htmlFor="webhookUrl" label={t.settings.webhookUrl}>
                <input
                  id="webhookUrl"
                  type="url"
                  value={form.webhookUrl}
                  onChange={(e) => setForm((c) => ({ ...c, webhookUrl: e.target.value }))}
                  className="input-base"
                />
              </FormField>
              <FormField htmlFor="webhookSecret" label={t.settings.webhookSecret}>
                <input
                  id="webhookSecret"
                  type="password"
                  value={form.webhookSecret}
                  placeholder={
                    settings?.webhookSecretConfigured ? t.settings.webhookSecretConfigured : ''
                  }
                  onChange={(e) => setForm((c) => ({ ...c, webhookSecret: e.target.value }))}
                  className="input-base"
                />
              </FormField>
              <Button
                type="button"
                onClick={() => void handleWebhookTest()}
                disabled={isTestingWebhook || !form.webhookUrl.trim()}
                variant="secondary"
              >
                {isTestingWebhook && <Loader2 className="h-4 w-4 animate-spin" />}
                {isTestingWebhook ? t.settings.testing : t.settings.testWebhook}
              </Button>
            </div>
          </div>

          <div className="border-t border-border-soft pt-4">
            <SectionHeader
              title={t.settings.telegramTitle}
              subtitle={`${t.settings.telegramBotToken}: ${settings?.telegramBotTokenConfigured ? t.settings.telegramBotConfigured : t.settings.telegramBotNotConfigured}`}
            />
            <FormField htmlFor="telegramChatId" label={t.settings.telegramChatId}>
              <input
                id="telegramChatId"
                value={form.telegramChatId}
                onChange={(e) => setForm((c) => ({ ...c, telegramChatId: e.target.value }))}
                className="input-base"
              />
            </FormField>
            <p className="mt-2 text-sm text-text-tertiary">{t.settings.telegramHint}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void handleTelegramTest()}
                disabled={
                  isTestingTelegram ||
                  !settings?.telegramBotTokenConfigured ||
                  !(form.telegramChatId.trim() || settings?.telegramChatId)
                }
                variant="secondary"
              >
                {isTestingTelegram && <Loader2 className="h-4 w-4 animate-spin" />}
                {isTestingTelegram ? t.settings.testing : t.settings.testTelegram}
              </Button>
            </div>
          </div>

          <div className="border-t border-border-soft pt-4">
            <SectionHeader
              title={t.settings.approvalTimeoutTitle}
              subtitle={t.settings.approvalTimeoutSubtitle}
            />
            <FormField htmlFor="approvalTimeoutSeconds" label={t.settings.seconds}>
              <input
                id="approvalTimeoutSeconds"
                type="number"
                min={10}
                max={3600}
                step={10}
                value={form.approvalTimeoutSeconds}
                onChange={(e) => {
                  const p = Number.parseInt(e.target.value, 10);
                  setForm((c) => ({
                    ...c,
                    approvalTimeoutSeconds: Number.isNaN(p) ? 120 : Math.min(3600, Math.max(10, p)),
                  }));
                }}
                className="input-base w-32"
              />
            </FormField>
          </div>

        </form>

        <SectionPanel>
          <SectionHeader
            icon={<Bell className="h-4 w-4" />}
            title={t.settings.pushTitle}
            subtitle={`${t.settings.pushStatus}: ${settings?.webPushEnabled ? t.settings.pushAvailable : t.settings.pushUnavailable}`}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void handlePushSubscribe()}
              disabled={push.busy || !push.supported || !settings?.webPushEnabled}
              variant="primary"
            >
              {push.busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {push.busy ? t.settings.working : t.settings.subscribe}
            </Button>
            <Button
              type="button"
              onClick={() => void handlePushUnsubscribe()}
              disabled={push.busy || !push.supported}
              variant="secondary"
            >
              {t.settings.unsubscribe}
            </Button>
          </div>
          {!push.supported && (
            <p className="mt-3 text-sm text-warning">{t.settings.pushNotSupported}</p>
          )}
          {!settings?.webPushEnabled && (
            <p className="mt-2 text-sm text-warning">{t.settings.pushVapidMissing}</p>
          )}
        </SectionPanel>
      </div>
    </div>
  );
}
