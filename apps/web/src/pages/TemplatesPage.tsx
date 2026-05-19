import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, FileText, Folder, Loader2, Play, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { Device, ExecutorType, TaskTemplate } from '../types.ts';
import {
  createTemplate,
  deleteTemplate,
  getDevices,
  getExecutors,
  getTemplates,
  runTemplate,
  updateTemplate,
} from '../api.ts';
import { Badge } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent } from '../components/ui/Card.tsx';
import { FormField } from '../components/ui/FormField.tsx';
import { Input } from '../components/ui/Input.tsx';
import { LoadingState } from '../components/ui/LoadingState.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBanner } from '../components/ui/StatusBanner.tsx';
import { formatClockTime, formatDate, getErrorMessage } from '../lib/format.ts';
import { useT } from '../i18n/index.ts';

interface TemplateForm {
  name: string;
  description: string;
  executorType: string;
  prompt: string;
  workDir: string;
  autoApprove: boolean;
}

function createForm(template?: TaskTemplate): TemplateForm {
  return {
    name: template?.name ?? '',
    description: template?.description ?? '',
    executorType: template?.executorType ?? '',
    prompt: template?.prompt ?? '',
    workDir: template?.workDir ?? '',
    autoApprove: template?.autoApprove ?? false,
  };
}

export default function TemplatesPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [executors, setExecutors] = useState<ExecutorType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateForm>(createForm());
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [showForm, setShowForm] = useState(false);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [loadedTemplates, loadedDevices, loadedExecutors] = await Promise.all([
        getTemplates(),
        getDevices(),
        getExecutors(),
      ]);
      setTemplates(loadedTemplates);
      setDevices(loadedDevices);
      setExecutors(loadedExecutors);
    } catch (err) {
      setError(getErrorMessage(err, t.templates.errorLoad));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only fetch
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      setError(t.templates.errorNameRequired);
      return;
    }
    if (!form.prompt.trim()) {
      setError(t.templates.errorPromptRequired);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        executorType: (form.executorType as ExecutorType | '') || undefined,
        prompt: form.prompt.trim(),
        workDir: form.workDir.trim() || undefined,
        autoApprove: form.autoApprove,
      } as Parameters<typeof createTemplate>[0];
      if (editing) await updateTemplate(editing, payload);
      else await createTemplate(payload);
      setEditing(null);
      setForm(createForm());
      setShowForm(false);
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, t.templates.errorSave));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t.delete)) return;
    setDeletingId(id);
    setError('');
    try {
      await deleteTemplate(id);
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, t.templates.errorDelete));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRun(id: string) {
    if (!selectedDevice) {
      setError(t.templates.errorNoDevice);
      return;
    }
    setRunningId(id);
    setError('');
    try {
      const task = await runTemplate(id, selectedDevice);
      navigate('/runs/' + task.id);
    } catch (err) {
      setError(getErrorMessage(err, t.templates.errorRun));
    } finally {
      setRunningId(null);
    }
  }

  function handleEdit(template: TaskTemplate) {
    setEditing(template.id);
    setForm(createForm(template));
    setError('');
    setShowForm(true);
  }

  function handleCancelEdit() {
    setEditing(null);
    setForm(createForm());
    setError('');
    setShowForm(false);
  }

  const trustedOnlineDevices = devices.filter(
    (device) => device.trusted && device.status === 'online'
  );

  if (loading) {
    return <LoadingState label={t.templates.loading} />;
  }

  return (
    <div className="page-shell">
      <PageHeader
        icon={<FileText className="h-4 w-4" />}
        title={t.templates.title}
        subtitle={t.templates.subtitle}
        className="flex-shrink-0"
        actions={
          <Button
            onClick={() => {
              setShowForm((value) => !value);
              setEditing(null);
              setForm(createForm());
              setError('');
            }}
            variant="primary"
          >
            <Plus className="h-4 w-4" />
            {showForm ? t.cancel : t.templates.createBtn}
          </Button>
        }
      />

      <StatusBanner tone="error" message={error} className="flex-shrink-0" />

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="flex-shrink-0 space-y-3 border border-border-default bg-bg-surface-2 p-4"
        >
          <p className="text-sm font-semibold text-text-primary">
            {editing ? t.templates.updateBtn : t.templates.createBtn}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField htmlFor="tpl-name" label={t.templates.nameLabel}>
              <Input
                id="tpl-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </FormField>
            <FormField htmlFor="tpl-executor" label={t.templates.executorLabel}>
              <select
                id="tpl-executor"
                value={form.executorType}
                onChange={(event) => setForm({ ...form, executorType: event.target.value })}
                className="input-base"
              >
                <option value="">-</option>
                {executors.map((executor) => (
                  <option key={executor} value={executor}>
                    {executor}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField htmlFor="tpl-desc" label={t.templates.descriptionLabel}>
            <Input
              id="tpl-desc"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </FormField>
          <FormField htmlFor="tpl-prompt" label={t.templates.promptLabel}>
            <textarea
              id="tpl-prompt"
              value={form.prompt}
              onChange={(event) => setForm({ ...form, prompt: event.target.value })}
              rows={4}
              className="input-base resize-none font-mono text-sm"
            />
          </FormField>
          <FormField htmlFor="tpl-workdir" label={t.templates.workDirLabel}>
            <Input
              id="tpl-workdir"
              value={form.workDir}
              onChange={(event) => setForm({ ...form, workDir: event.target.value })}
            />
          </FormField>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={form.autoApprove}
              onChange={(event) => setForm({ ...form, autoApprove: event.target.checked })}
              className="h-4 w-4 rounded-xs border-border-default bg-bg-surface-2 accent-accent"
            />
            <span className="text-sm text-text-secondary">{t.templates.autoApprove}</span>
          </label>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" disabled={saving} variant="primary">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving
                ? t.templates.saving
                : editing
                  ? t.templates.updateBtn
                  : t.templates.createBtn}
            </Button>
            {editing && (
              <Button onClick={handleCancelEdit} variant="secondary">
                {t.templates.cancelEdit}
              </Button>
            )}
          </div>
        </form>
      )}

      {trustedOnlineDevices.length > 0 ? (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-text-secondary">{t.templates.runDevice}:</span>
          <select
            value={selectedDevice}
            onChange={(event) => setSelectedDevice(event.target.value)}
            className="input-base max-w-xs"
          >
            <option value="">-</option>
            {trustedOnlineDevices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="flex-shrink-0 text-sm text-warning">{t.templates.noTrustedDevices}</div>
      )}

      <div className="scroll-area space-y-3 pb-2">
        {templates.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center border border-border-default bg-bg-surface-3">
              <FileText className="h-6 w-6 text-text-tertiary" />
            </div>
            <p className="font-medium text-text-secondary">{t.templates.noTemplates}</p>
          </div>
        ) : (
          templates.map((template) => (
            <Card
              key={template.id}
              className="transition-colors duration-140 hover:border-border-strong"
            >
              <CardContent>
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-text-primary">{template.name}</h3>
                    {template.description && (
                      <p className="mt-0.5 text-sm text-text-secondary">{template.description}</p>
                    )}
                  </div>
                  {template.executorType && (
                    <Badge className="flex-shrink-0">{template.executorType}</Badge>
                  )}
                </div>

                <p className="mb-3 line-clamp-2 font-mono text-xs text-text-tertiary">
                  {template.prompt}
                </p>

                <div className="mb-3 flex flex-wrap gap-2 text-xs text-text-disabled">
                  {template.workDir && (
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <Folder className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{template.workDir}</span>
                    </span>
                  )}
                  {template.autoApprove && (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <ShieldCheck className="h-3 w-3" />
                      {t.templates.autoApprove}
                    </span>
                  )}
                  <span className="ml-auto">
                    {t.templates.updatedAt(
                      formatClockTime(template.updatedAt),
                      formatDate(template.updatedAt)
                    )}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 border-t border-border-soft pt-3">
                  <Button onClick={() => handleEdit(template)} variant="ghost" size="sm">
                    {t.templates.editBtn}
                  </Button>
                  <Button
                    onClick={() => navigate('/workbench', { state: { template } })}
                    variant="outline"
                    size="sm"
                  >
                    <Bot className="h-3.5 w-3.5" />
                    {t.templates.useInForm}
                  </Button>
                  <Button
                    onClick={() => void handleRun(template.id)}
                    disabled={runningId === template.id || !selectedDevice}
                    variant="primary"
                    size="sm"
                  >
                    {runningId === template.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    {runningId === template.id ? t.templates.running : t.templates.runNow}
                  </Button>
                  <Button
                    onClick={() => void handleDelete(template.id)}
                    disabled={deletingId === template.id}
                    variant="danger"
                    size="sm"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deletingId === template.id ? t.templates.deleting : t.delete}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
