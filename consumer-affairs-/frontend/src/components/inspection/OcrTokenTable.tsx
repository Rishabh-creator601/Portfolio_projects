'use client';

import React, { useMemo, useState } from 'react';
import { Table, Column } from '@/components/ui/Table';
import { SearchBar } from '@/components/ui/SearchBar';
import type { OcrToken } from '@/types/inspection';

interface OcrTokenTableProps {
  tokens: OcrToken[];
  engine?: string | null;
}

/** Below this an OCR read is not trustworthy enough to extract from silently. */
const LOW_CONFIDENCE = 0.7;

/**
 * Raw extraction table -- every OCR token with its text, position, confidence
 * and panel. Low-confidence rows are tinted so a misread is visible at a glance
 * rather than buried inside a declaration.
 */
export function OcrTokenTable({ tokens, engine }: OcrTokenTableProps) {
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tokens.filter((token) => {
      if (lowOnly && (token.confidence ?? 0) >= LOW_CONFIDENCE) return false;
      if (query && !token.text.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [tokens, search, lowOnly]);

  const lowCount = tokens.filter((t) => (t.confidence ?? 0) < LOW_CONFIDENCE).length;

  const columns: Column<OcrToken>[] = [
    {
      key: 'text',
      label: 'Recognised text',
      render: (token) => (
        <span
          className={
            (token.confidence ?? 0) < LOW_CONFIDENCE
              ? 'font-medium text-verdict-review'
              : 'text-slate-800'
          }
        >
          {token.text}
        </span>
      ),
    },
    {
      key: 'confidence',
      label: 'Confidence',
      align: 'right',
      render: (token) => {
        const value = Math.round((token.confidence ?? 0) * 100);
        const low = (token.confidence ?? 0) < LOW_CONFIDENCE;
        return (
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-cyan-100">
              <span
                className={`block h-full rounded-full ${low ? 'bg-verdict-review' : 'bg-cyan-bright'}`}
                style={{ width: `${value}%` }}
              />
            </span>
            <span className={`font-mono text-xs ${low ? 'text-verdict-review' : 'text-slate-600'}`}>
              {value}%
            </span>
          </span>
        );
      },
    },
    {
      key: 'script',
      label: 'Script',
      render: (token) => <span className="text-xs text-slate-500">{token.script || '—'}</span>,
    },
    {
      key: 'panel',
      label: 'Panel',
      render: (token) => <span className="text-xs text-slate-500">{token.panel || 'principal'}</span>,
    },
    {
      key: 'bbox',
      label: 'Position (x, y, w × h)',
      render: (token) => {
        const [x0, y0, x1, y1] = token.bbox || [];
        if (x0 === undefined) return <span className="text-slate-400">—</span>;
        return (
          <span className="font-mono text-xs text-slate-500">
            {x0}, {y0} · {x1 - x0} × {y1 - y0}
          </span>
        );
      },
    },
  ];

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-cyan-100 bg-cyan-50/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="section-title">Raw OCR extraction</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {tokens.length} token{tokens.length === 1 ? '' : 's'}
            {engine ? ` read by ${engine}` : ''}
            {lowCount > 0 ? ` · ${lowCount} below ${LOW_CONFIDENCE * 100}% confidence` : ''}
          </p>
        </div>

        {lowCount > 0 && (
          <label className="flex items-center gap-2 text-xs font-medium text-cyan-900">
            <input
              type="checkbox"
              checked={lowOnly}
              onChange={(e) => setLowOnly(e.target.checked)}
              className="h-4 w-4 rounded border-cyan-300 text-cyan-bright focus:ring-cyan-bright"
            />
            Low confidence only
          </label>
        )}
      </div>

      <div className="border-b border-cyan-100 p-3">
        <SearchBar onSearch={setSearch} placeholder="Filter tokens…" delay={200} />
      </div>

      <Table
        columns={columns}
        data={rows}
        rowKey={(_, index) => String(index)}
        emptyMessage="No OCR tokens match this filter."
      />
    </section>
  );
}

export default OcrTokenTable;
