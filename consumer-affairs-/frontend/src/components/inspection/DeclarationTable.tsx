'use client';

import React from 'react';
import { Table, Column } from '@/components/ui/Table';
import type { ExtractedDeclarations } from '@/types/inspection';

interface DeclarationRow {
  head: string;
  citation: string;
  declared: string | null;
  normalised: string | null;
  confidence: number | null;
}

interface DeclarationTableProps {
  extracted?: ExtractedDeclarations;
}

/**
 * Structured declaration table -- the raw text mapped onto the six statutory
 * heads, showing what was printed beside what the system normalised it to.
 * Keeping both visible is what lets an officer see where a reading went wrong.
 */
export function DeclarationTable({ extracted = {} }: DeclarationTableProps) {
  const confidence = extracted.additionalInfo?.confidence || {};

  const rows: DeclarationRow[] = [
    {
      head: 'Manufacturer / packer',
      citation: 'Rule 6(1)(a)',
      declared: extracted.manufacturer?.name ?? null,
      normalised: extracted.manufacturer?.qualifier
        ? `${extracted.manufacturer.qualifier}: ${extracted.manufacturer.name ?? ''}`.trim()
        : extracted.manufacturer?.name ?? null,
      confidence: confidence.manufacturer ?? null,
    },
    {
      head: 'Complete address',
      citation: 'Rule 6(1)(a) / 10(1)',
      declared: extracted.manufacturer?.address ?? null,
      normalised: extracted.manufacturer?.address ?? null,
      confidence: confidence.manufacturer ?? null,
    },
    {
      head: 'Common or generic name',
      citation: 'Rule 6(1)(b)',
      declared: extracted.genericName ?? null,
      normalised: extracted.genericName ?? null,
      confidence: confidence.genericName ?? null,
    },
    {
      head: 'Net quantity',
      citation: 'Rule 6(1)(c)',
      declared: extracted.netQuantity?.raw ?? null,
      normalised:
        extracted.netQuantity?.value != null
          ? `${extracted.netQuantity.value} ${extracted.netQuantity.unit ?? ''}`.trim()
          : null,
      confidence: confidence.netQuantity ?? null,
    },
    {
      head: 'Month & year of packing',
      citation: 'Rule 6(1)(d)',
      declared: extracted.monthYear?.raw ?? null,
      normalised:
        extracted.monthYear?.month && extracted.monthYear?.year
          ? `${extracted.monthYear.month}/${extracted.monthYear.year}`
          : null,
      confidence: confidence.monthYear ?? null,
    },
    {
      head: 'Retail sale price',
      citation: 'Rule 6(1)(e)',
      declared: extracted.mrp?.raw ?? null,
      normalised: extracted.mrp?.value != null ? `Rs ${extracted.mrp.value.toFixed(2)}` : null,
      confidence: confidence.mrp ?? null,
    },
    {
      head: 'Consumer care',
      citation: 'Rule 6(2)',
      declared:
        [extracted.consumerCare?.phone, extracted.consumerCare?.email].filter(Boolean).join(' · ') ||
        null,
      normalised:
        [
          extracted.consumerCare?.name,
          extracted.consumerCare?.phone,
          extracted.consumerCare?.email,
        ]
          .filter(Boolean)
          .join(' · ') || null,
      confidence: confidence.consumerCare ?? null,
    },
  ];

  const columns: Column<DeclarationRow>[] = [
    {
      key: 'head',
      label: 'Declaration head',
      render: (row) => (
        <div>
          <p className="font-medium text-cyan-950">{row.head}</p>
          <p className="font-mono text-xs text-cyan-700">{row.citation}</p>
        </div>
      ),
    },
    {
      key: 'declared',
      label: 'As printed',
      render: (row) =>
        row.declared ? (
          <span className="text-slate-700">{row.declared}</span>
        ) : (
          <span className="italic text-verdict-fail">Not detected</span>
        ),
    },
    {
      key: 'normalised',
      label: 'Normalised',
      render: (row) =>
        row.normalised ? (
          <span className="font-mono text-xs text-slate-700">{row.normalised}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: 'confidence',
      label: 'Confidence',
      align: 'right',
      render: (row) =>
        row.confidence != null && row.confidence > 0 ? (
          <span
            className={`font-mono text-xs ${
              row.confidence < 0.7 ? 'text-verdict-review' : 'text-slate-600'
            }`}
          >
            {Math.round(row.confidence * 100)}%
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
  ];

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-cyan-100 bg-cyan-50/60 px-5 py-3">
        <h2 className="section-title">Statutory declarations</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          The six mandatory heads under Rule 6, as printed and as normalised.
        </p>
      </div>

      <Table columns={columns} data={rows} rowKey={(row) => row.head} />
    </section>
  );
}

export default DeclarationTable;
