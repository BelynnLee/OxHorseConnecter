import type { ReactNode } from 'react';
import {
  AlertCircle,
  ClipboardCheck,
  DatabaseZap,
  FolderGit2,
  Gauge,
  KeyRound,
  Network,
  Play,
  type LucideIcon,
} from 'lucide-react';
import { FormField } from '../ui/FormField.tsx';
import { SectionHeader, SectionPanel } from '../ui/SectionPanel.tsx';
import { StatCard } from '../ui/StatCard.tsx';
import { StatusBanner } from '../ui/StatusBanner.tsx';

export type ControlPlaneTabId =
  | 'projects'
  | 'providers'
  | 'runs'
  | 'metrics'
  | 'rag'
  | 'evals'
  | 'mcp'
  | 'analysis';

export interface MetricGroup {
  key?: string;
  label?: string;
  totalSessions: number;
  completedSessions: number;
  failedSessions: number;
  cancelledSessions: number;
  successRate: number;
}

interface GroupTableText {
  name: string;
  sessions: string;
  completed: string;
  failed: string;
  cancelled: string;
  success: string;
  unassigned: string;
  noRows: string;
}

export const controlPlaneTabs: Array<{ id: ControlPlaneTabId; icon: LucideIcon }> = [
  { id: 'projects', icon: FolderGit2 },
  { id: 'providers', icon: KeyRound },
  { id: 'runs', icon: Play },
  { id: 'metrics', icon: Gauge },
  { id: 'rag', icon: DatabaseZap },
  { id: 'evals', icon: ClipboardCheck },
  { id: 'mcp', icon: Network },
  { id: 'analysis', icon: AlertCircle },
];

export function percent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

export function duration(value: number): string {
  if (!value) return '0 ms';
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${Math.round(value / 100) / 10} s`;
  return `${Math.round(value / 6000) / 10} min`;
}

export function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function statusTone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'muted' {
  if (['enabled', 'ready', 'completed', 'approved', 'allow'].includes(status)) return 'success';
  if (['indexing', 'running', 'queued', 'pending', 'ask'].includes(status)) return 'warning';
  if (['failed', 'disabled', 'rejected', 'deny'].includes(status)) return 'danger';
  if (['readonly', 'general'].includes(status)) return 'info';
  return 'muted';
}

export function mappedLabel(labels: object, key: string): string {
  return (labels as Record<string, string>)[key] ?? key;
}

export function ControlPlaneSection({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SectionPanel className="min-w-0">
      <SectionHeader
        icon={<Icon className="h-4 w-4" />}
        title={title}
        actions={action}
        titleClassName="truncate uppercase tracking-[0.06em]"
      />
      {children}
    </SectionPanel>
  );
}

export function ControlPlaneField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FormField
      label={label}
      labelClassName="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary"
    >
      {children}
    </FormField>
  );
}

export function ControlPlaneStatusLine({ error, notice }: { error: string; notice: string }) {
  if (error) return <StatusBanner tone="error" message={error} />;
  if (notice) return <StatusBanner tone="success" message={notice} />;
  return null;
}

export function ControlPlaneStatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <StatCard
      label={label}
      value={value}
      hint={sub}
      className="rounded-sm border-border-soft bg-bg-app shadow-none"
      contentClassName="block px-3 py-3"
      labelClassName="text-xs font-semibold tracking-[0.08em]"
      valueClassName="mt-2"
      hintClassName="mt-1 text-xs"
    />
  );
}

export function ControlPlaneGroupTable({
  rows,
  text,
}: {
  rows: MetricGroup[];
  text: GroupTableText;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-left text-sm">
        <thead className="text-xs uppercase tracking-[0.08em] text-text-tertiary">
          <tr className="border-b border-border-soft">
            <th className="py-2 pr-3 font-semibold">{text.name}</th>
            <th className="py-2 pr-3 font-semibold">{text.sessions}</th>
            <th className="py-2 pr-3 font-semibold">{text.completed}</th>
            <th className="py-2 pr-3 font-semibold">{text.failed}</th>
            <th className="py-2 pr-3 font-semibold">{text.cancelled}</th>
            <th className="py-2 font-semibold">{text.success}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.key ?? 'unknown'}-${row.label ?? ''}`}
              className="border-b border-border-soft last:border-0"
            >
              <td className="py-2 pr-3 text-text-primary">
                {row.label || row.key || text.unassigned}
              </td>
              <td className="py-2 pr-3 text-text-secondary">{row.totalSessions}</td>
              <td className="py-2 pr-3 text-text-secondary">{row.completedSessions}</td>
              <td className="py-2 pr-3 text-text-secondary">{row.failedSessions}</td>
              <td className="py-2 pr-3 text-text-secondary">{row.cancelledSessions}</td>
              <td className="py-2 text-text-secondary">{percent(row.successRate)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="py-4 text-text-tertiary" colSpan={6}>
                {text.noRows}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
