/* Industrial Sentinel Design System - Status Badges */

const STATUS_CONFIG: Record<string, { dot: string; bg: string; pulseOrb?: boolean }> = {
  online: {
    dot: 'bg-tertiary shadow-[0_0_8px_#4edea3]',
    bg: 'bg-tertiary/10 text-tertiary',
    pulseOrb: true,
  },
  offline: {
    dot: 'bg-on-surface-variant/40',
    bg: 'bg-surface-container-highest text-on-surface-variant',
  },
  degraded: {
    dot: 'bg-error',
    bg: 'bg-error-container/20 text-error',
  },
};

export function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CONFIG[status] ?? STATUS_CONFIG.offline;

  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold tracking-tight ${c.bg}`}>
      <span
        className={`w-2 h-2 rounded-full ${c.dot} ${c.pulseOrb ? 'animate-pulse' : ''}`}
      />
      {status.toUpperCase()}
    </span>
  );
}

export function TunnelTypeBadge({ type }: { type: 'browser' | 'local' }) {
  const styles = {
    browser: 'bg-tertiary/10 text-tertiary',
    local: 'bg-primary/10 text-primary',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[type]}`}>
      {type === 'browser' ? 'Browser' : 'Local'}
    </span>
  );
}
