'use client';

import React from 'react';
import { Ruler, ScanEye } from 'lucide-react';
import type { VisionMeasurements } from '@/types/inspection';

interface MeasurementPanelProps {
  measurements?: VisionMeasurements | null;
  engine?: string | null;
  warnings?: string[];
}

const CONFIDENCE_STYLES: Record<string, string> = {
  HIGH: 'border-verdict-pass/25 bg-verdict-pass/10 text-verdict-pass',
  MEDIUM: 'border-verdict-review/25 bg-verdict-review/10 text-verdict-review',
  LOW: 'border-slate-200 bg-slate-100 text-slate-600',
};

function Band({ value }: { value?: string }) {
  if (!value) return null;
  return (
    <span className={`chip ${CONFIDENCE_STYLES[value] || CONFIDENCE_STYLES.LOW}`}>{value}</span>
  );
}

function Row({
  label,
  value,
  confidence,
  notes,
}: {
  label: string;
  value: React.ReactNode;
  confidence?: string;
  notes?: string[];
}) {
  return (
    <div className="border-b border-cyan-50 py-3 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-cyan-950">{label}</p>
          <p className="mt-0.5 font-mono text-sm text-slate-700">{value}</p>
        </div>
        <Band value={confidence} />
      </div>
      {notes && notes.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {notes.map((note, i) => (
            <li key={i} className="text-xs italic text-slate-500">
              {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const mm = (value?: number | null) => (value == null ? 'Not measured' : `${value.toFixed(2)} mm`);

/**
 * The physical measurements behind Rules 7, 8 and 9.
 *
 * Shown because a verdict an officer has to defend is only as good as the
 * measurement under it. Heights come from connected components on a binarised
 * crop, never from an OCR bounding box -- those are sized to a text region and
 * skew high by 20-40%, which would report violations that are not there.
 */
export function MeasurementPanel({ measurements, engine, warnings = [] }: MeasurementPanelProps) {
  if (!measurements) {
    return (
      <section className="card p-5">
        <div className="mb-2 flex items-center gap-2">
          <Ruler className="h-4 w-4 text-cyan-700" aria-hidden="true" />
          <h2 className="section-title">Physical measurements</h2>
        </div>
        <p className="text-sm text-slate-600">
          No measurement pass has been run on this inspection. Rules 7, 8 and 9(1)(b) prescribe
          values in millimetres, so those checks will read <strong>needs review</strong> until a
          capture with a scale reference is analysed.
        </p>
      </section>
    );
  }

  const { quality, calibration, numeral, contrast, clearSpace, panelGeometry } = measurements;

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-cyan-100 bg-cyan-50/60 px-5 py-3">
        <div className="flex items-center gap-2">
          <Ruler className="h-4 w-4 text-cyan-700" aria-hidden="true" />
          <div>
            <h2 className="section-title">Physical measurements</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Binarised connected components, not OCR boxes
              {engine ? ` · localised by ${engine}` : ''}
            </p>
          </div>
        </div>
      </div>

      <div className="px-5">
        <Row
          label="Millimetre calibration"
          value={
            calibration?.mm_per_px
              ? `${calibration.mm_per_px.toFixed(4)} mm/px from ${calibration.source.replace(/_/g, ' ')}`
              : 'No scale reference in frame'
          }
          confidence={calibration?.confidence}
          notes={calibration?.notes}
        />

        <Row
          label="Numeral height — Rule 7(2)"
          value={
            numeral?.median_digit_height_mm != null
              ? `${mm(numeral.median_digit_height_mm)} (median of ${numeral.glyph_count ?? 0} glyphs)`
              : 'Not measured'
          }
          confidence={numeral?.confidence}
          notes={numeral?.notes}
        />

        <Row
          label="Letter width — Rule 7(3)"
          value={mm(numeral?.median_letter_width_mm)}
          confidence={numeral?.confidence}
        />

        <Row
          label="Contrast — Rule 9(1)(b)"
          value={
            contrast?.ratio != null
              ? `${contrast.ratio}:1 ${contrast.meets_wcag_aa ? '(meets 3:1)' : '(below 3:1)'}`
              : 'Not measured'
          }
          confidence={contrast?.confidence}
          notes={contrast?.notes}
        />

        <Row
          label="Clear space — Rule 8(1)"
          value={
            clearSpace?.above_mm != null
              ? `above ${mm(clearSpace.above_mm)} · below ${mm(clearSpace.below_mm)} · left ${mm(
                  clearSpace.left_mm
                )} · right ${mm(clearSpace.right_mm)}`
              : 'Not measured'
          }
          confidence={clearSpace?.confidence}
          notes={clearSpace?.notes}
        />

        <Row
          label="Principal display panel area"
          value={panelGeometry?.area_cm2 != null ? `${panelGeometry.area_cm2} cm²` : 'Not measured'}
          confidence={panelGeometry?.confidence}
        />

        {quality && (
          <Row
            label="Capture quality"
            value={
              `focus ${quality.blur_score?.toFixed(0) ?? '—'} · ` +
              `glare ${((quality.glare_ratio ?? 0) * 100).toFixed(1)}% · ` +
              (quality.accepted ? 'accepted' : 'rejected')
            }
            confidence={quality.accepted ? 'HIGH' : 'LOW'}
            notes={quality.warnings}
          />
        )}
      </div>

      {warnings.length > 0 && (
        <div className="border-t border-cyan-100 bg-cyan-50/40 px-5 py-3">
          <div className="flex items-start gap-2">
            <ScanEye className="mt-0.5 h-4 w-4 flex-shrink-0 text-cyan-700" aria-hidden="true" />
            <ul className="space-y-1">
              {warnings.map((warning, i) => (
                <li key={i} className="text-xs text-slate-600">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

export default MeasurementPanel;
