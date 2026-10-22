import React from 'react';
import { clsx } from 'clsx';

interface KPICardProps {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  hint?: string;
  tone?: 'cyan' | 'pass' | 'fail' | 'review';
  isLoading?: boolean;
}

const tones = {
  cyan: { icon: 'bg-cyan-50 text-cyan-700', value: 'text-cyan-950', bar: 'bg-cyan-bright' },
  pass: { icon: 'bg-verdict-pass/10 text-verdict-pass', value: 'text-verdict-pass', bar: 'bg-verdict-pass' },
  fail: { icon: 'bg-verdict-fail/10 text-verdict-fail', value: 'text-verdict-fail', bar: 'bg-verdict-fail' },
  review: {
    icon: 'bg-verdict-review/10 text-verdict-review',
    value: 'text-verdict-review',
    bar: 'bg-verdict-review',
  },
};

export function KPICard({ title, value, icon, hint, tone = 'cyan', isLoading }: KPICardProps) {
  const style = tones[tone];

  return (
    <div className="card-interactive relative overflow-hidden p-5">
      <span className={clsx('absolute inset-x-0 top-0 h-0.5', style.bar)} aria-hidden="true" />

      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium text-slate-500">{title}</h3>
        {icon && <span className={clsx('grid h-9 w-9 place-items-center rounded-lg', style.icon)}>{icon}</span>}
      </div>

      {isLoading ? (
        <div className="skeleton h-9 w-24" />
      ) : (
        <p className={clsx('text-3xl font-bold tracking-tight', style.value)}>{value}</p>
      )}

      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default KPICard;
