'use client';

import React from 'react';
import { Check, Info, ScanSearch, X } from 'lucide-react';
import type { ExtractionReport as Report } from '@/types/inspection';

interface ExtractionReportProps {
  report?: Report | null;
}

function StatusRow({
  citation,
  label,
  value,
  found,
}: {
  citation?: string;
  label: string;
  value?: React.ReactNode;
  found: boolean;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-cyan-50 py-3 last:border-0">
      <span
        className={`mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full ${
          found ? 'bg-verdict-pass/10 text-verdict-pass' : 'bg-slate-100 text-slate-400'
        }`}
      >
        {found ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          {citation && <span className="font-mono text-xs text-cyan-700">{citation}</span>}
          <span className="text-sm font-medium text-cyan-950">{label}</span>
        </div>
        <p className={`mt-0.5 break-words text-sm ${found ? 'text-slate-700' : 'italic text-slate-400'}`}>
          {found ? value : 'Not found on this image'}
        </p>
      </div>
    </div>
  );
}

const NUTRIENTS: Array<[string, string, string]> = [
  ['energy_kcal', 'Energy', 'kcal'],
  ['protein_g', 'Protein', 'g'],
  ['carbohydrate_g', 'Carbohydrate', 'g'],
  ['total_sugars_g', '— total sugars', 'g'],
  ['added_sugars_g', '— added sugars', 'g'],
  ['total_fat_g', 'Total fat', 'g'],
  ['saturated_fat_g', '— saturated fat', 'g'],
  ['trans_fat_g', '— trans fat', 'g'],
  ['cholesterol_mg', 'Cholesterol', 'mg'],
  ['sodium_mg', 'Sodium', 'mg'],
];

/**
 * The client extraction report.
 *
 * Reports what was read and what was absent. It deliberately shows no verdicts:
 * whether a missing declaration is a breach turns on the product category and
 * its exemptions, which the rule engine decides — and that engine is inactive
 * in this build.
 */
export function ExtractionReport({ report }: ExtractionReportProps) {
  if (!report) {
    return (
      <section className="card p-6 text-center">
        <ScanSearch className="mx-auto mb-3 h-8 w-8 text-cyan-400" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-cyan-950">No extraction yet</h2>
        <p className="mt-1 text-sm text-slate-500">
          Capture or upload a package image and the label will be read here.
        </p>
      </section>
    );
  }

  const { summary, declarations = [], fssai = [], nutrition, package: pack, detections = [] } = report;
  const nutritionRows = NUTRIENTS.filter(
    ([key]) => nutrition && nutrition[key] !== null && nutrition[key] !== undefined
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Summary */}
      <section className="card overflow-hidden">
        <div className="border-b border-cyan-100 bg-cyan-50/60 px-5 py-3">
          <h2 className="section-title">Extraction summary</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Read by {summary.model || 'the extraction model'}
            {summary.processingTimeMs ? ` in ${(summary.processingTimeMs / 1000).toFixed(1)}s` : ''}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Product</p>
            <p className="mt-0.5 text-sm font-medium text-cyan-950">{summary.product}</p>
            {summary.brand && <p className="text-xs text-slate-500">{summary.brand}</p>}
          </div>
          <div>
            <p className="text-xs text-slate-500">Package</p>
            <p className="mt-0.5 text-sm font-medium text-cyan-950">
              {pack?.type || summary.packageType || '—'}
            </p>
            {(pack?.material || summary.packageMaterial) && (
              <p className="text-xs text-slate-500">{pack?.material || summary.packageMaterial}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-500">Declarations located</p>
            <p className="mt-0.5 text-2xl font-bold text-cyan-950">
              {summary.declarationsFound}
              <span className="text-base font-normal text-slate-400">
                /{summary.declarationsTotal}
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Regions detected</p>
            <p className="mt-0.5 text-2xl font-bold text-cyan-950">{detections.length}</p>
          </div>
        </div>

        {pack?.is_curved_surface && (
          <p className="border-t border-cyan-100 bg-cyan-50/40 px-5 py-2.5 text-xs text-cyan-900">
            Curved surface detected — millimetre measurements on this pack would vary across the
            label, so size checks would need a flat capture with a scale reference.
          </p>
        )}
      </section>

      {/* Rule 6 declarations */}
      <section className="card overflow-hidden">
        <div className="border-b border-cyan-100 bg-cyan-50/60 px-5 py-3">
          <h2 className="section-title">Statutory declarations</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            The mandatory heads under Rule 6, as printed on the pack
          </p>
        </div>
        <div className="px-5">
          {declarations.map((row) => (
            <StatusRow
              key={row.key}
              citation={row.citation}
              label={row.label}
              value={row.value}
              found={row.status === 'found'}
            />
          ))}
        </div>
      </section>

      {/* FSSAI */}
      <section className="card overflow-hidden">
        <div className="border-b border-cyan-100 bg-cyan-50/60 px-5 py-3">
          <h2 className="section-title">Food labelling particulars</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            FSSAI Labelling and Display Regulations, 2020 — a separate statute
          </p>
        </div>
        <div className="px-5">
          {fssai
            .filter((row) => row.key !== 'nutrition')
            .map((row) => (
              <StatusRow
                key={row.key}
                label={row.label}
                value={typeof row.value === 'string' ? row.value : JSON.stringify(row.value)}
                found={row.status === 'found'}
              />
            ))}
        </div>
      </section>

      {/* Nutrition */}
      {nutritionRows.length > 0 && (
        <section className="card overflow-hidden">
          <div className="border-b border-cyan-100 bg-cyan-50/60 px-5 py-3">
            <h2 className="section-title">Nutrition panel</h2>
            {nutrition?.basis && (
              <p className="mt-0.5 text-xs text-slate-500">Basis: {nutrition.basis}</p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-cyan-100 text-xs uppercase tracking-wide text-cyan-900">
                  <th className="px-5 py-2 font-semibold">Nutrient</th>
                  <th className="px-5 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {nutritionRows.map(([key, label, unit]) => (
                  <tr key={key} className="border-b border-cyan-50 last:border-0">
                    <td className="px-5 py-2.5 text-sm text-slate-700">{label}</td>
                    <td className="px-5 py-2.5 text-right font-mono text-sm text-cyan-950">
                      {String(nutrition?.[key])} {unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Detected regions */}
      {detections.length > 0 && (
        <section className="card overflow-hidden">
          <div className="border-b border-cyan-100 bg-cyan-50/60 px-5 py-3">
            <h2 className="section-title">Regions located on the image</h2>
          </div>
          <ul className="divide-y divide-cyan-50">
            {detections.map((detection, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <span className="text-sm capitalize text-cyan-950">
                  {String(detection.region).replace(/_/g, ' ')}
                </span>
                <span className="font-mono text-xs text-slate-500">
                  {detection.box
                    ? `${detection.box.x}, ${detection.box.y} · ${detection.box.width}×${detection.box.height}`
                    : 'normalised only'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Legibility issues */}
      {report.legibilityIssues && report.legibilityIssues.length > 0 && (
        <section className="card p-5">
          <h2 className="section-title mb-2">Could not be read</h2>
          <ul className="space-y-1">
            {report.legibilityIssues.map((issue, i) => (
              <li key={i} className="text-sm text-verdict-review">
                • {issue}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Disclaimer */}
      {report.disclaimer && (
        <div className="flex items-start gap-2.5 rounded-lg border border-cyan-200 bg-cyan-50 p-4 text-xs leading-relaxed text-cyan-900">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>{report.disclaimer}</span>
        </div>
      )}
    </div>
  );
}

export default ExtractionReport;
