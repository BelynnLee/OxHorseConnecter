import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { Activity, KeyRound, Loader2, Plus, Power, Trash2 } from 'lucide-react';
import type { PublicProviderConfig } from '../../types.ts';
import { useT } from '../../i18n/index.ts';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { ControlPlaneField, ControlPlaneSection, mappedLabel } from './ControlPlaneCommon.tsx';

type ProviderForm = {
  name: string;
  type: string;
  baseUrl: string;
  apiKey: string;
  models: string;
  usagePurpose: string;
  timeoutMs: string;
};

export function ControlPlaneProvidersTab({
  providers,
  providerForm,
  busy,
  onProviderFormChange,
  onSubmit,
  onTestProvider,
  onToggleProvider,
  onDeleteProvider,
}: {
  providers: PublicProviderConfig[];
  providerForm: ProviderForm;
  busy: string;
  onProviderFormChange: Dispatch<SetStateAction<ProviderForm>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTestProvider: (provider: PublicProviderConfig) => void;
  onToggleProvider: (provider: PublicProviderConfig) => void;
  onDeleteProvider: (provider: PublicProviderConfig) => void;
}) {
  const { t } = useT();
  const cp = t.controlPlane;

  return (
    <div className="grid gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
      <ControlPlaneSection title={cp.sections.providerProfile} icon={KeyRound}>
        <form onSubmit={onSubmit} className="space-y-3">
          <ControlPlaneField label={cp.fields.name}>
            <Input
              value={providerForm.name}
              onChange={(event) =>
                onProviderFormChange({ ...providerForm, name: event.target.value })
              }
              required
            />
          </ControlPlaneField>
          <div className="grid gap-3 sm:grid-cols-2">
            <ControlPlaneField label={cp.fields.type}>
              <select
                className="input-base"
                value={providerForm.type}
                onChange={(event) =>
                  onProviderFormChange({ ...providerForm, type: event.target.value })
                }
              >
                <option value="openai-compatible">OpenAI-compatible</option>
                <option value="openrouter">OpenRouter</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </ControlPlaneField>
            <ControlPlaneField label={cp.fields.purpose}>
              <select
                className="input-base"
                value={providerForm.usagePurpose}
                onChange={(event) =>
                  onProviderFormChange({ ...providerForm, usagePurpose: event.target.value })
                }
              >
                <option value="general">{cp.purposes.general}</option>
                <option value="agent">{cp.purposes.agent}</option>
                <option value="rag">{cp.purposes.rag}</option>
                <option value="evaluation">{cp.purposes.evaluation}</option>
                <option value="failure_analysis">{cp.purposes.failureAnalysis}</option>
              </select>
            </ControlPlaneField>
          </div>
          <ControlPlaneField label={cp.fields.baseUrl}>
            <Input
              value={providerForm.baseUrl}
              onChange={(event) =>
                onProviderFormChange({ ...providerForm, baseUrl: event.target.value })
              }
            />
          </ControlPlaneField>
          <ControlPlaneField label={cp.fields.apiKey}>
            <Input
              type="password"
              value={providerForm.apiKey}
              onChange={(event) =>
                onProviderFormChange({ ...providerForm, apiKey: event.target.value })
              }
            />
          </ControlPlaneField>
          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <ControlPlaneField label={cp.fields.models}>
              <Input
                value={providerForm.models}
                onChange={(event) =>
                  onProviderFormChange({ ...providerForm, models: event.target.value })
                }
              />
            </ControlPlaneField>
            <ControlPlaneField label={cp.fields.timeoutMs}>
              <Input
                inputMode="numeric"
                value={providerForm.timeoutMs}
                onChange={(event) =>
                  onProviderFormChange({ ...providerForm, timeoutMs: event.target.value })
                }
              />
            </ControlPlaneField>
          </div>
          <Button
            type="submit"
            variant="primary"
            disabled={busy === 'provider-create' || !providerForm.name.trim()}
          >
            {busy === 'provider-create' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {t.save}
          </Button>
        </form>
      </ControlPlaneSection>

      <ControlPlaneSection title={cp.sections.providers} icon={KeyRound}>
        <div className="space-y-3">
          {providers.map((provider) => (
            <div key={provider.id} className="rounded-sm border border-border-soft bg-bg-app p-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-text-primary">
                      {provider.name}
                    </p>
                    <Badge tone={provider.enabled ? 'success' : 'danger'}>
                      {provider.enabled ? cp.statusLabels.enabled : cp.statusLabels.disabled}
                    </Badge>
                    <Badge tone="info">{provider.type}</Badge>
                    <Badge tone="outline">{mappedLabel(cp.purposes, provider.usagePurpose)}</Badge>
                    {provider.readonly && <Badge tone="muted">{cp.statusLabels.readonly}</Badge>}
                    {provider.hasApiKey && <Badge tone="success">{cp.statusLabels.key}</Badge>}
                  </div>
                  <p className="mt-1 break-all text-xs text-text-tertiary">
                    {provider.baseUrl || '-'}
                  </p>
                  {provider.models.length > 0 && (
                    <p className="mt-1 text-xs text-text-secondary">{provider.models.join(', ')}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => onTestProvider(provider)}
                  >
                    {busy === `provider-test-${provider.id}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Activity className="h-4 w-4" />
                    )}
                    {cp.actions.test}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={provider.enabled ? 'outline' : 'primary'}
                    disabled={provider.readonly}
                    onClick={() => onToggleProvider(provider)}
                  >
                    <Power className="h-4 w-4" />
                    {provider.enabled ? cp.actions.disable : cp.actions.enable}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    disabled={provider.readonly}
                    onClick={() => onDeleteProvider(provider)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {providers.length === 0 && (
            <p className="text-sm text-text-tertiary">{cp.empty.noProviders}</p>
          )}
        </div>
      </ControlPlaneSection>
    </div>
  );
}
