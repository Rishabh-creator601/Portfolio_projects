'use client';

import React, { useMemo, useState } from 'react';
import { PenLine } from 'lucide-react';
import { Table, Column } from '@/components/ui/Table';
import { StatusPill } from '@/components/ui/StatusPill';
import type { ComplianceResult, RuleVerdict } from '@/types/inspection';

interface ChecklistTableProps {
  results: ComplianceResult[];
  canOverride?: boolean;
  onOverride?: (result: ComplianceResult) => void;
  rulePackVersion?: string;
}

const effective = (r: ComplianceResult): RuleVerdict =>
  r.overridden && r.overrideVerdict ? r.overrideVerdict : r.verdict;

const FILTERS: Array<{ key: string; label: string; match: (r: ComplianceResult) => boolean }> = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'FAIL', label: 'Failed', match: (r) => effective(r) === 'FAIL' },
  { key: 'REVIEW', label: 'Needs review', match: (r) => effective(r) === 'REVIEW' },
  { key: 'PASS', label: 'Passed', match: (r) => effective(r) === 'PASS' },
  { key: 'NOT_APPLICABLE', label: 'N/A', match: (r) => effective(r) === 'NOT_APPLICABLE' },
];

const confidenceLabel = (value?: number | string) => {
  if (value == null) return null;
  if (typeof value === 'number') return `${Math.round(value * 100)}%`;
  return String(value);
};

const confidenceTone = (value?: number | string) => {
  const label = typeof value === 'string' ? value.toUpperCase() : null;
  if (label === 'LOW' || (typeof value === 'number' && value < 0.6)) return 'text-verdict-review';
  if (label === 'MEDIUM' || (typeof value === 'number' && value < 0.8)) return 'text-cyan-700';
  return 'text-slate-500';
};

/**
 * The statutory checklist as a table: one row per rule, each carrying its
 * citation, what was found, what the Rules require, and the verdict. A REVIEW
 * row always shows why, because an unexplained "needs review" is no more useful
 * to an officer than a wrong verdict.
 */
export function ChecklistTable({
  results,
  canOverride = false,
  onOverride,
  rulePackVersion,
}: ChecklistTableProps) {
  const [filter, setFilter] = useState('all');

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: results.length };
    for (const f of FILTERS.slice(1)) out[f.key] = results.filter(f.match).length;
    return out;
  }, [results]);

  const rows = useMemo(() => {
    const active = FILTERS.find((f) => f.key === filter) || FILTERS[0];
    return results.filter(active.match);
  }, [results, filter]);

  const columns: Column<ComplianceResult>[] = [
    {
      key: 'citation',
      label: 'Citation',
      render: (r) => (
        <div>
          <p className="font-mono text-xs font-semibold text-cyan-700">{r.citation || r.ruleId}</p>
          <p className="mt-0.5 text-sm font-medium text-cyan-950">{r.check}</p>
        </div>
      ),
    },
    {
      key: 'found',
      label: 'What was found',
      render: (r) => (
        <div>
          <p className="text-slate-700">{r.found || '—'}</p>
          {r.note && <p className="mt-1 text-xs italic text-slate-500">{r.note}</p>}
          {r.overrideReason && (
            <p className="mt-1 rounded bg-cyan-50 px-2 py-1 text-xs text-cyan-900">
              Officer: {r.overrideReason}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'required',
      label: 'What the Rules require',
      render: (r) => <span className="text-xs text-slate-600">{r.required || '—'}</span>,
    },
    {
      key: 'measured',
      label: 'Measured',
      render: (r) =>
        r.measuredValue ? (
          <div className="font-mono text-xs">
            <p className="text-cyan-950">{r.measuredValue}</p>
            {r.prescribedValue && <p className="text-slate-500">vs {r.prescribedValue}</p>}
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: 'verdict',
      label: 'Verdict',
      align: 'right',
      render: (r) => (
        <div className="flex flex-col items-end gap-1.5">
          <StatusPill verdict={effective(r)} />
          {r.overridden && (
            <span className="chip border-cyan-300 bg-cyan-100 text-cyan-900">Overridden</span>
          )}
          {r.confidence != null && (
            <span className={`text-[11px] ${confidenceTone(r.confidence)}`}>
              {confidenceLabel(r.confidence)} confidence
            </span>
          )}
          {canOverride && onOverride && (
            <button
              onClick={() => onOverride(r)}
              className="focus-ring inline-flex items-center gap-1 rounded text-xs font-medium text-cyan-700 hover:text-cyan-900"
            >
              <PenLine className="h-3 w-3" aria-hidden="true" />
              Override
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-cyan-100 bg-cyan-50/60 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="section-title">Compliance checklist</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Rule pack v{rulePackVersion || '1.0.0'} · deterministic evaluation, one row per rule
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`focus-ring rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                filter === f.key
                  ? 'bg-cyan-bright text-white'
                  : 'bg-white text-cyan-800 ring-1 ring-cyan-200 hover:bg-cyan-50'
              }`}
            >
              {f.label}
              <span className={filter === f.key ? 'ml-1 opacity-80' : 'ml-1 text-slate-400'}>
                {counts[f.key] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Table
        columns={columns}
        data={rows}
        rowKey={(r) => r.ruleId}
        emptyMessage={
          results.length === 0
            ? 'This inspection has not been evaluated yet.'
            : 'No rules match this filter.'
        }
      />
    </section>
  );
}

export default ChecklistTable;
