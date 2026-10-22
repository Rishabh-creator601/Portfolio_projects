'use client';

import React, { useMemo, useState } from 'react';
import { SearchBar } from '@/components/ui/SearchBar';
import { Table, Column } from '@/components/ui/Table';
import { useApi } from '@/lib/hooks';
import { ruleService } from '@/lib/services';
import { AUTOMATION_STYLES, SEVERITY_STYLES, formatCurrency } from '@/lib/constants';
import type { Rule } from '@/types/rule';

type View = 'pack' | 'matrix';

const AUTOMATION_NOTE: Record<string, string> = {
  full: 'Decided automatically and recorded as stated.',
  assisted: 'Produces a measurement and a provisional verdict; an officer confirms before it closes.',
  flagged: 'Never auto-decided. Raised for officer judgement with the evidence attached.',
};

export default function RulesPage() {
  const [view, setView] = useState<View>('pack');
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [automationLevel, setAutomationLevel] = useState('');

  const rules = useApi(
    () => ruleService.list({ search, severity, automationLevel }),
    [search, severity, automationLevel]
  );

  const rows = rules.data?.data ?? [];
  const version = rules.data?.meta?.version;

  const counts = useMemo(() => {
    const out = { full: 0, assisted: 0, flagged: 0 };
    for (const rule of rows) {
      if (rule.automationLevel in out) out[rule.automationLevel as keyof typeof out] += 1;
    }
    return out;
  }, [rows]);

  const packColumns: Column<Rule>[] = [
    {
      key: 'citation',
      label: 'Citation',
      sortable: true,
      render: (r) => <span className="font-mono text-sm font-semibold text-cyan-700">{r.citation}</span>,
    },
    {
      key: 'subject',
      label: 'Subject',
      sortable: true,
      render: (r) => <span className="font-medium text-cyan-950">{r.subject}</span>,
    },
    {
      key: 'description',
      label: 'What it requires',
      render: (r) => <span className="text-slate-600">{r.description}</span>,
    },
    {
      key: 'severity',
      label: 'Severity',
      sortable: true,
      render: (r) => (
        <span className={`chip ${SEVERITY_STYLES[r.severity] || SEVERITY_STYLES.minor}`}>
          {r.severity?.toUpperCase()}
        </span>
      ),
    },
    {
      key: 'penaltyAmount',
      label: 'Penalty',
      align: 'right',
      render: (r) =>
        r.penaltyAmount ? (
          <span className="font-medium text-cyan-950">{formatCurrency(r.penaltyAmount)}</span>
        ) : (
          <span className="text-xs text-slate-400">Advisory</span>
        ),
    },
  ];

  const matrixColumns: Column<Rule>[] = [
    {
      key: 'citation',
      label: 'Citation',
      sortable: true,
      render: (r) => <span className="font-mono text-sm font-semibold text-cyan-700">{r.citation}</span>,
    },
    {
      key: 'subject',
      label: 'Automated check',
      sortable: true,
      render: (r) => <span className="font-medium text-cyan-950">{r.subject}</span>,
    },
    {
      key: 'method',
      label: 'Method',
      render: (r) => (
        <span className="text-xs leading-relaxed text-slate-600">{r.method || r.description}</span>
      ),
    },
    {
      key: 'automationLevel',
      label: 'Automation',
      sortable: true,
      align: 'right',
      render: (r) => (
        <div className="flex flex-col items-end gap-1">
          <span className={`chip ${AUTOMATION_STYLES[r.automationLevel] || AUTOMATION_STYLES.assisted}`}>
            {r.automationLevel?.toUpperCase()}
          </span>
          <span className="max-w-[16rem] text-right text-[11px] text-slate-500">
            {AUTOMATION_NOTE[r.automationLevel]}
          </span>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl p-4 lg:p-8">
      <div className="mb-6 flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <h1 className="page-title">Legal Metrology (PCR) 2011 rules</h1>
          <p className="page-subtitle">
            The statute as the engine evaluates it, with citations, Rule 32 penalties and an honest
            automation level for every row.
          </p>
        </div>
        {version && (
          <span className="chip self-start border-cyan-200 bg-cyan-50 text-cyan-800">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-bright" aria-hidden="true" />
            Rule pack v{version}
          </span>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2 border-b border-cyan-100">
        {(
          [
            { key: 'pack', label: 'Rule pack', hint: 'What each rule requires' },
            { key: 'matrix', label: 'Validation matrix', hint: 'How each is machine-tested' },
          ] as Array<{ key: View; label: string; hint: string }>
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setView(tab.key)}
            className={`focus-ring -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              view === tab.key
                ? 'border-cyan-bright text-cyan-900'
                : 'border-transparent text-slate-500 hover:text-cyan-800'
            }`}
            title={tab.hint}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {view === 'matrix' && (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(
            [
              ['full', 'Full', 'Decided automatically'],
              ['assisted', 'Assisted', 'Measured, then officer-confirmed'],
              ['flagged', 'Flagged', 'Officer judgement only'],
            ] as const
          ).map(([key, label, note]) => (
            <div key={key} className="card p-4">
              <div className="flex items-center justify-between">
                <span className={`chip ${AUTOMATION_STYLES[key]}`}>{label.toUpperCase()}</span>
                <span className="text-2xl font-bold text-cyan-950">{counts[key]}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">{note}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card mb-6 flex flex-col gap-4 p-4 lg:flex-row">
        <div className="flex-1">
          <SearchBar onSearch={setSearch} placeholder="Search by citation, subject or keyword…" />
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="input w-auto"
            aria-label="Filter by severity"
          >
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="major">Major</option>
            <option value="minor">Minor</option>
          </select>
          <select
            value={automationLevel}
            onChange={(e) => setAutomationLevel(e.target.value)}
            className="input w-auto"
            aria-label="Filter by automation level"
          >
            <option value="">All automation levels</option>
            <option value="full">Full</option>
            <option value="assisted">Assisted</option>
            <option value="flagged">Flagged</option>
          </select>
        </div>
      </div>

      <Table
        columns={view === 'pack' ? packColumns : matrixColumns}
        data={rows}
        isLoading={rules.isLoading}
        error={rules.error}
        onRetry={rules.reload}
        rowKey={(r) => r.id}
        emptyMessage="No rules match your search."
      />

      {view === 'matrix' && (
        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Assisted means assisted. Rows marked assisted or flagged produce a measurement and a
          provisional verdict, but the case does not close until an officer confirms it. A system
          that is right ninety per cent of the time and says clearly which ten per cent it is unsure
          about is usable in enforcement; one that is right ninety-five per cent of the time and
          silent about which five per cent is not.
        </p>
      )}
    </div>
  );
}
