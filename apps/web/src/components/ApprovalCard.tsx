import { useEffect, useState } from 'react';
import type { Approval } from '../types.ts';
import { formatDateTime } from '../lib/format.ts';
import { useT } from '../i18n/index.ts';

const RISK_STYLES: Record<string, { badge: string; bar: string }> = {
  low:      { badge: 'bg-success-soft border-success/30 text-success',   bar: 'bg-success' },
  medium:   { badge: 'bg-warning-soft border-warning/30 text-warning',   bar: 'bg-warning' },
  high:     { badge: 'bg-warning-soft border-warning/30 text-warning',   bar: 'bg-warning' },
  critical: { badge: 'bg-danger-soft border-danger/30 text-danger',      bar: 'bg-danger' },
};

const DEFAULT_RISK = { badge: 'bg-bg-surface-3 border-border-default text-text-secondary', bar: 'bg-text-tertiary' };

function formatCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface ApprovalCardProps {
  approval: Approval;
  processing: boolean;
  onDecision: (decision: 'approve' | 'reject') => Promise<void>;
}

export function ApprovalCard({ approval, processing, onDecision }: ApprovalCardProps) {
  const { t } = useT();
  const [showCommand, setShowCommand] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!approval.timeoutAt) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [approval.timeoutAt]);

  const timeoutAtMs = approval.timeoutAt ? Date.parse(approval.timeoutAt) : Number.NaN;
  const createdAtMs = Date.parse(approval.createdAt);
  const hasCountdown = Number.isFinite(timeoutAtMs) && Number.isFinite(createdAtMs) && timeoutAtMs > createdAtMs;
  const totalWindowMs = hasCountdown ? timeoutAtMs - createdAtMs : 0;
  const remainingMs = hasCountdown ? Math.max(timeoutAtMs - now, 0) : 0;
  const progressPercent = hasCountdown && totalWindowMs > 0
    ? Math.max(0, Math.min(100, (remainingMs / totalWindowMs) * 100))
    : 0;

  const riskStyle = RISK_STYLES[approval.riskLevel] ?? DEFAULT_RISK;
  const isUrgent = ['high', 'critical'].includes(approval.riskLevel);
  const isPending = approval.status === 'pending';

  function triggerDecision(decision: 'approve' | 'reject') {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([200]);
    }
    void onDecision(decision);
  }

  return (
    <section data-testid="approval-card" className={`rounded-md border p-5 ${
      isUrgent
        ? 'bg-danger-soft border-danger/40'
        : 'bg-warning-soft border-warning/40'
    }`}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-sm flex items-center justify-center flex-shrink-0 ${
            isUrgent ? 'bg-danger/20' : 'bg-warning/20'
          }`}>
            <svg className={`w-4 h-4 ${isUrgent ? 'text-danger' : 'text-warning'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            </svg>
          </div>
          <div>
            <h2 className={`text-base font-semibold ${isUrgent ? 'text-danger' : 'text-warning'}`}>
              {t.approval.title}
            </h2>
            <p className="text-sm text-text-secondary mt-0.5">{approval.reason}</p>
          </div>
        </div>
        <span className={`status-badge border ${riskStyle.badge}`}>
          {approval.riskLevel}
        </span>
      </div>

      {/* Command preview */}
      {approval.commandPreview && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowCommand((current) => !current)}
            className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
              isUrgent ? 'text-danger hover:text-danger/80' : 'text-warning hover:text-warning/80'
            }`}
          >
            <svg className={`w-3.5 h-3.5 transition-transform ${showCommand ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
            </svg>
            {showCommand ? t.approval.hideCommand : t.approval.showCommand}
          </button>
          {showCommand && (
            <pre className="mt-3 overflow-x-auto rounded-sm border border-border-default bg-bg-surface-1 px-4 py-3 text-xs leading-5 text-text-secondary font-mono">
              {approval.commandPreview}
            </pre>
          )}
        </div>
      )}

      {/* Countdown */}
      {hasCountdown && (
        <div className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-tertiary mb-2">
            <span className={remainingMs > 0 ? (isUrgent ? 'text-danger' : 'text-warning') : 'text-text-disabled'}>
              {remainingMs > 0 ? t.approval.timeLeft(formatCountdown(remainingMs)) : t.approval.expired}
            </span>
            <span>{formatDateTime(approval.timeoutAt!)}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-bg-surface-3">
            <div
              className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${riskStyle.bar}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 mt-2">
          <button
            type="button"
            data-testid="approval-approve"
            onClick={() => triggerDecision('approve')}
            disabled={processing}
            aria-label={t.approval.approveActionLabel}
            className="h-14 rounded-sm bg-success text-white text-base font-semibold flex items-center justify-center gap-2
                       hover:opacity-90 active:opacity-80 disabled:opacity-50 transition-opacity"
          >
            {processing ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
              </svg>
            )}
            {processing ? t.approval.processing : t.approval.approve}
          </button>
          <button
            type="button"
            data-testid="approval-reject"
            onClick={() => triggerDecision('reject')}
            disabled={processing}
            aria-label={t.approval.rejectActionLabel}
            className="h-14 rounded-sm bg-danger text-white text-base font-semibold flex items-center justify-center gap-2
                       hover:opacity-90 active:opacity-80 disabled:opacity-50 transition-opacity"
          >
            {processing ? null : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            )}
            {processing ? t.approval.processing : t.approval.reject}
          </button>
        </div>
      ) : (
        <div className="mt-2 rounded-sm border border-border-soft bg-bg-surface-1 px-3 py-2 text-sm text-text-secondary">
          {t.approval.statusLine(approval.status, approval.resolvedBy)}
        </div>
      )}
    </section>
  );
}
