'use client';

import { clsx } from 'clsx';
import { VERDICT_STYLES } from '@/lib/constants';

interface StatusPillProps {
  verdict?: string;
  status?: string;
  label?: string;
  className?: string;
}

/**
 * Renders a compliance outcome. Verdict colours are reserved and never reused
 * for branding, so anything unrecognised falls back to neutral slate.
 */
export function StatusPill({ verdict, status, label, className }: StatusPillProps) {
  const key = verdict || status || '';
  const style = VERDICT_STYLES[key] || VERDICT_STYLES[key.toUpperCase()] || {
    label: key ? key.replace(/_/g, ' ') : 'Unknown',
    className: 'bg-cyan-50 text-cyan-800 border-cyan-200',
    dot: 'bg-cyan-bright',
  };

  return (
    <span className={clsx('chip', style.className, className)}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', style.dot)} aria-hidden="true" />
      {label || style.label}
    </span>
  );
}

export default StatusPill;
