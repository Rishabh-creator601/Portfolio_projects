'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, SpellCheck } from 'lucide-react';
import type { SpellCheckResult } from '@/types/inspection';

interface SpellCheckPanelProps {
  result?: SpellCheckResult;
  found?: string;
  note?: string | null;
}

const CERTAINTY_STYLES: Record<string, string> = {
  high: 'border-verdict-review/30 bg-verdict-review/10 text-verdict-review',
  medium: 'border-cyan-200 bg-cyan-50 text-cyan-800',
  low: 'border-slate-200 bg-slate-50 text-slate-600',
};

const CERTAINTY_LABELS: Record<string, string> = {
  high: 'Probable misspelling',
  medium: 'Close to a known term',
  low: 'Unrecognised — may be a brand name',
};

/**
 * Description spelling check.
 *
 * Advisory only: misspelling a description is not an offence under the Rules,
 * so this carries no penalty and never fails an inspection. Its second job is
 * as an OCR-quality signal -- a cluster of short nonsense words says the read
 * was bad, not that the manufacturer cannot spell.
 */
export function SpellCheckPanel({ result, found, note }: SpellCheckPanelProps) {
  if (!result) return null;

  const score = Math.round(result.score * 100);
  const probable = result.misspellings.filter((m) => m.certainty === 'high');
  const clean = result.misspellings.length === 0;

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-cyan-100 bg-cyan-50/60 px-5 py-3">
        <div className="flex items-center gap-2">
          <SpellCheck className="h-4 w-4 text-cyan-700" aria-hidden="true" />
          <div>
            <h2 className="section-title">Description spelling</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Advisory · no penalty · doubles as an OCR-quality signal
            </p>
          </div>
        </div>

        <div className="text-right">
          <p
            className={`text-xl font-bold ${
              score >= 90 ? 'text-verdict-pass' : score >= 70 ? 'text-cyan-800' : 'text-verdict-review'
            }`}
          >
            {score}%
          </p>
          <p className="text-[11px] text-slate-500">{result.checkedWords} words checked</p>
        </div>
      </div>

      <div className="p-5">
        {result.likelyOCRError && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-verdict-review/25 bg-verdict-review/5 p-3 text-sm text-verdict-review">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>
              This pattern looks like a poor OCR read rather than a labelling error. Re-capture the
              panel, or correct the tokens above, before relying on this extraction.
            </span>
          </div>
        )}

        {clean ? (
          <div className="flex items-center gap-2 text-sm text-verdict-pass">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Every word was recognised against the Legal Metrology lexicon.
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-600">
              {probable.length > 0
                ? `${probable.length} probable misspelling${probable.length === 1 ? '' : 's'}`
                : 'No probable misspellings'}
              {result.misspellings.length > probable.length &&
                ` · ${result.misspellings.length - probable.length} unrecognised word${
                  result.misspellings.length - probable.length === 1 ? '' : 's'
                }`}
            </p>

            <ul className="flex flex-col gap-2">
              {result.misspellings.map((item, index) => (
                <li
                  key={`${item.word}-${index}`}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
                    CERTAINTY_STYLES[item.certainty] || CERTAINTY_STYLES.low
                  }`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono font-medium">{item.original || item.word}</span>
                    <span className="text-[11px] opacity-80">{CERTAINTY_LABELS[item.certainty]}</span>
                  </div>

                  {item.suggestions.length > 0 && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="opacity-70">did you mean</span>
                      {item.suggestions.map((suggestion) => (
                        <span
                          key={suggestion}
                          className="rounded bg-white/70 px-1.5 py-0.5 font-mono font-medium"
                        >
                          {suggestion}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {found && <p className="mt-4 text-xs text-slate-500">{found}</p>}
        {note && <p className="mt-1 text-xs italic text-slate-500">{note}</p>}
      </div>
    </section>
  );
}

export default SpellCheckPanel;
