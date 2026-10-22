'use client';

import React from 'react';
import { Info } from 'lucide-react';
import type { CaptureContext } from '@/lib/services';

interface CaptureContextFormProps {
  value: CaptureContext;
  onChange: (next: CaptureContext) => void;
  disabled?: boolean;
}

const PANELS = [
  { value: 'principal', label: 'Principal display panel' },
  { value: 'side', label: 'Side panel' },
  { value: 'back', label: 'Back panel' },
  { value: 'other', label: 'Other panel' },
];

/** Common references an officer is likely to have to hand. */
const REFERENCES = [
  { label: 'ID / credit card (85.6 mm)', width: 85.6, kind: 'reference_card' as const },
  { label: 'Ten rupee note, long edge (137 mm)', width: 137, kind: 'reference_card' as const },
  { label: 'Steel rule, 100 mm mark', width: 100, kind: 'reference_card' as const },
  { label: 'Other — enter a known dimension', width: 0, kind: 'known_dimension' as const },
];

/**
 * The questions the officer answers at capture.
 *
 * Which panel this is, and whether the declaration is moulded, are deliberately
 * asked rather than inferred: they are a UI answer to what would otherwise be a
 * segmentation problem, and a person answers them correctly every time. The
 * reference width is what converts pixels to millimetres, and therefore what
 * makes the Rule 7 checks a measurement instead of a guess.
 */
export function CaptureContextForm({ value, onChange, disabled }: CaptureContextFormProps) {
  const set = (patch: Partial<CaptureContext>) => onChange({ ...value, ...patch });

  const selectedReference =
    REFERENCES.find((r) => r.width === value.referenceWidthMm && r.width !== 0)?.label ??
    (value.referenceWidthMm ? REFERENCES[REFERENCES.length - 1].label : '');

  return (
    <div className="card p-4">
      <h2 className="section-title mb-1">Capture details</h2>
      <p className="mb-4 text-xs text-slate-500">
        These answers drive Rules 7, 8 and 9. Without a scale reference the font-size checks
        return <strong>needs review</strong> rather than a verdict the photograph cannot support.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="panel" className="label">
            Which panel is this?
          </label>
          <select
            id="panel"
            value={value.panel || 'principal'}
            onChange={(e) => set({ panel: e.target.value })}
            disabled={disabled}
            className="input"
          >
            {PANELS.map((panel) => (
              <option key={panel.value} value={panel.value}>
                {panel.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">Rule 8 turns on this.</p>
        </div>

        <div>
          <label htmlFor="reference" className="label">
            Scale reference in frame
          </label>
          <select
            id="reference"
            value={selectedReference}
            onChange={(e) => {
              const reference = REFERENCES.find((r) => r.label === e.target.value);
              if (!reference) {
                set({ referenceWidthMm: undefined, referenceKind: undefined });
              } else if (reference.width === 0) {
                set({ referenceWidthMm: undefined, referenceKind: 'known_dimension' });
              } else {
                set({ referenceWidthMm: reference.width, referenceKind: reference.kind });
              }
            }}
            disabled={disabled}
            className="input"
          >
            <option value="">None — checks will need review</option>
            {REFERENCES.map((reference) => (
              <option key={reference.label} value={reference.label}>
                {reference.label}
              </option>
            ))}
          </select>
        </div>

        {value.referenceKind === 'known_dimension' && (
          <div>
            <label htmlFor="referenceWidth" className="label">
              Known width (mm)
            </label>
            <input
              id="referenceWidth"
              type="number"
              min={1}
              step={0.1}
              value={value.referenceWidthMm ?? ''}
              onChange={(e) =>
                set({ referenceWidthMm: e.target.value ? Number(e.target.value) : undefined })
              }
              disabled={disabled}
              className="input"
              placeholder="e.g. 62.5"
            />
            <p className="mt-1 text-xs text-slate-500">
              Measure the object or package edge that is flat to the lens.
            </p>
          </div>
        )}

        <div className="flex flex-col justify-end gap-2 sm:col-span-2">
          <label className="flex items-start gap-2 text-sm text-cyan-900">
            <input
              type="checkbox"
              checked={Boolean(value.isBlownOrMoulded)}
              onChange={(e) => set({ isBlownOrMoulded: e.target.checked })}
              disabled={disabled}
              className="mt-0.5 h-4 w-4 rounded border-cyan-300 text-cyan-bright focus:ring-cyan-bright"
            />
            <span>
              Declaration is blown, formed, moulded, embossed or perforated
              <span className="block text-xs text-slate-500">
                Rule 7(2) doubles every minimum height; Rule 9(1)(b) contrast stops applying.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm text-cyan-900">
            <input
              type="checkbox"
              checked={Boolean(value.isCurvedSurface)}
              onChange={(e) => set({ isCurvedSurface: e.target.checked })}
              disabled={disabled}
              className="mt-0.5 h-4 w-4 rounded border-cyan-300 text-cyan-bright focus:ring-cyan-bright"
            />
            <span>
              Curved surface — bottle, pouch or tube
              <span className="block text-xs text-slate-500">
                Scale varies across a curved label, so measurements are routed to review.
              </span>
            </span>
          </label>
        </div>
      </div>

      {!value.referenceWidthMm && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-900">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span>
            Place a card flat beside the quantity declaration and pick it above. A photograph
            carries no physical scale, so this is the only way the millimetre checks can run.
          </span>
        </div>
      )}
    </div>
  );
}

export default CaptureContextForm;
