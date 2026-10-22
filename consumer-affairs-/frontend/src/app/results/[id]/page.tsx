'use client';

import React, { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Gavel, ScanSearch } from 'lucide-react';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ReportDownloader } from '@/components/reports/ReportDownloader';
import { ChecklistTable } from '@/components/inspection/ChecklistTable';
import { ExtractionReport } from '@/components/inspection/ExtractionReport';
import { DeclarationTable } from '@/components/inspection/DeclarationTable';
import { OcrTokenTable } from '@/components/inspection/OcrTokenTable';
import { SpellCheckPanel } from '@/components/inspection/SpellCheckPanel';
import { MeasurementPanel } from '@/components/inspection/MeasurementPanel';
import { useApi } from '@/lib/hooks';
import { inspectionService } from '@/lib/services';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { STATUS_LABELS, formatCurrency, formatDateTime } from '@/lib/constants';
import type { ComplianceResult, Inspection, PopulatedRef, RuleVerdict } from '@/types/inspection';

const effectiveVerdict = (r: ComplianceResult): RuleVerdict =>
  r.overridden && r.overrideVerdict ? r.overrideVerdict : r.verdict;

const asRef = (value: unknown): PopulatedRef | null =>
  value && typeof value === 'object' ? (value as PopulatedRef) : null;

type Tab = 'checklist' | 'compliance' | 'declarations' | 'tokens';

/**
 * Where the back link goes. An inspection is opened from several places, so the
 * origin travels in `?from=` and the link returns the officer to the list they
 * actually came from rather than always dropping them on the dashboard.
 */
const BACK_TARGETS: Record<string, { href: string; label: string }> = {
  repository: { href: '/repository', label: 'Back to repository' },
  dashboard: { href: '/dashboard', label: 'Back to dashboard' },
};

const DEFAULT_BACK = BACK_TARGETS.dashboard;

function ResultsPageInner({ params }: { params: { id: string } }) {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const back = BACK_TARGETS[searchParams?.get('from') || ''] || DEFAULT_BACK;
  const inspection = useApi(() => inspectionService.byId(params.id), [params.id]);

  const [tab, setTab] = useState<Tab | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<ComplianceResult | null>(null);
  const [overrideVerdict, setOverrideVerdict] = useState<RuleVerdict>('PASS');
  const [overrideReason, setOverrideReason] = useState('');
  const [adjudicateOpen, setAdjudicateOpen] = useState(false);
  const [adjudicateVerdict, setAdjudicateVerdict] = useState('compliant');
  const [remarks, setRemarks] = useState('');

  const data = inspection.data;
  const canAdjudicate = !!user && ['senior_inspector', 'controller'].includes(user.role);
  const canEvaluate = !!user && ['field_inspector', 'senior_inspector', 'controller'].includes(user.role);

  const summary = useMemo(() => {
    const results = data?.results ?? [];
    return {
      pass: results.filter((r) => effectiveVerdict(r) === 'PASS').length,
      fail: results.filter((r) => effectiveVerdict(r) === 'FAIL').length,
      review: results.filter((r) => effectiveVerdict(r) === 'REVIEW').length,
      na: results.filter((r) => effectiveVerdict(r) === 'NOT_APPLICABLE').length,
    };
  }, [data]);

  const spellRow = useMemo(
    () => (data?.results ?? []).find((r) => r.ruleId === 'SPELL'),
    [data]
  );

  const runAction = async (key: string, action: () => Promise<Inspection>) => {
    setBusy(key);
    setActionError(null);
    try {
      inspection.setData(await action());
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'That action could not be completed.');
    } finally {
      setBusy(null);
    }
  };

  if (inspection.isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
        <div className="skeleton h-10 w-72" />
        <div className="grid gap-4 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-20 w-full" />
          ))}
        </div>
        <div className="skeleton h-96 w-full" />
      </div>
    );
  }

  if (inspection.error || !data) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <div className="card p-8 text-center">
          <h1 className="text-lg font-bold text-cyan-950">Inspection unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">
            {inspection.error || 'This inspection was not found.'}
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <Button variant="secondary" onClick={inspection.reload}>
              Try again
            </Button>
            <Link href={back.href}>
              <Button variant="ghost">{back.label}</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const product = asRef(data.productId);
  const officer = asRef(data.officerId);
  const additional = data.extracted?.additionalInfo;

  // Extraction mode: the model read the label and the rule engine is dormant,
  // so there is no checklist to show and no verdict to claim.
  const isExtractionMode = Boolean(data.extractionReport);

  const hasVerdicts = data.results.length > 0;

  // Land on the most decided view available.
  const activeTab: Tab = tab ?? (hasVerdicts ? 'compliance' : 'checklist');

  const tabs: Array<{ key: Tab; label: string; count?: number }> = isExtractionMode
    ? [
        ...(hasVerdicts
          ? [{ key: 'compliance' as Tab, label: 'Compliance', count: data.results.length }]
          : []),
        { key: 'checklist', label: 'Extraction report' },
        { key: 'declarations', label: 'Statutory declarations', count: 7 },
      ]
    : [
        { key: 'checklist', label: 'Compliance checklist', count: data.results.length },
        { key: 'declarations', label: 'Statutory declarations', count: 7 },
        { key: 'tokens', label: 'Raw OCR', count: data.ocrTokens?.length ?? 0 },
      ];

  return (
    <div className="mx-auto max-w-7xl p-4 lg:p-8">
      <Link
        href={back.href}
        className="focus-ring mb-4 inline-flex items-center gap-1.5 rounded text-sm text-cyan-700 hover:text-cyan-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {back.label}
      </Link>

      <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="page-title font-mono">{data.ref}</h1>
            <StatusPill verdict={data.verdict} />
            <span className="chip border-cyan-200 bg-cyan-50 text-cyan-800">
              {STATUS_LABELS[data.status] || data.status}
            </span>
            {isExtractionMode ? (
              <span className="chip border-cyan-300 bg-cyan-50 text-cyan-800">
                Extraction only · {data.extractionReport?.summary.model || 'model'}
              </span>
            ) : (
              additional?.ocrEngine && (
                <span className="chip border-cyan-200 bg-white text-cyan-700">
                  OCR: {additional.ocrEngine}
                </span>
              )
            )}
          </div>
          <p className="page-subtitle">
            {product
              ? `${product.brand || ''} ${product.genericName || ''}`.trim()
              : data.extracted?.genericName || 'Unidentified product'}
            {officer?.displayName ? ` · Raised by ${officer.displayName}` : ''} ·{' '}
            {formatDateTime(data.createdAt)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canEvaluate && (
            <Button
              variant="secondary"
              isLoading={busy === 'evaluate'}
              onClick={() => runAction('evaluate', () => inspectionService.evaluate(data._id))}
            >
              <ScanSearch className="h-4 w-4" aria-hidden="true" />
              {hasVerdicts ? 'Re-run compliance check' : 'Run compliance check'}
            </Button>
          )}
          <ReportDownloader
            inspectionId={data._id}
            inspectionRef={data.ref}
            extractionOnly={isExtractionMode}
          />
          {canAdjudicate && hasVerdicts && (
            <Button onClick={() => setAdjudicateOpen(true)}>
              <Gavel className="h-4 w-4" aria-hidden="true" />
              Adjudicate
            </Button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="mb-6 rounded-lg border border-verdict-fail/25 bg-verdict-fail/5 p-3 text-sm text-verdict-fail">
          {actionError}
        </div>
      )}

      {hasVerdicts && (
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: 'Passed', value: summary.pass, tone: 'text-verdict-pass' },
          { label: 'Failed', value: summary.fail, tone: 'text-verdict-fail' },
          { label: 'Needs review', value: summary.review, tone: 'text-verdict-review' },
          { label: 'Not applicable', value: summary.na, tone: 'text-slate-500' },
          {
            label: 'Penalty exposure',
            value: formatCurrency(data.penalties?.total ?? 0),
            tone: 'text-cyan-950',
          },
        ].map((item) => (
          <div key={item.label} className="card p-4">
            <p className="text-xs font-medium text-slate-500">{item.label}</p>
            <p className={`mt-1 text-2xl font-bold ${item.tone}`}>{item.value}</p>
          </div>
        ))}
      </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <div className="mb-4 flex flex-wrap gap-2 border-b border-cyan-100">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`focus-ring -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === t.key
                    ? 'border-cyan-bright text-cyan-900'
                    : 'border-transparent text-slate-500 hover:text-cyan-800'
                }`}
              >
                {t.label}
                {t.count !== undefined && (
                  <span className="ml-1.5 text-xs text-slate-400">{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {activeTab === 'compliance' && isExtractionMode && (
            <div className="flex flex-col gap-4">
              {data.complianceSummary && (
                <section className="card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="section-title">
                        {data.complianceSummary.categoryName || data.complianceSummary.category}
                      </h2>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {data.complianceSummary.categoryMatchedOn
                          ? `Category matched on "${data.complianceSummary.categoryMatchedOn}"`
                          : 'No category matched; baseline declarations only'}
                        {data.complianceSummary.rulePackVersion
                          ? ` \u00b7 rule pack v${data.complianceSummary.rulePackVersion}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3 text-center">
                      {[
                        ['Passed', data.complianceSummary.passed, 'text-verdict-pass'],
                        ['Failed', data.complianceSummary.failed, 'text-verdict-fail'],
                        ['Review', data.complianceSummary.review, 'text-verdict-review'],
                        ['N/A', data.complianceSummary.notApplicable, 'text-slate-500'],
                        ['Not assessed', data.complianceSummary.notAssessed, 'text-cyan-700'],
                      ].map(([label, count, tone]) => (
                        <div key={String(label)}>
                          <p className={`text-xl font-bold ${tone}`}>{count as number}</p>
                          <p className="text-[11px] text-slate-500">{label as string}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {data.complianceSummary.inScope === false && data.complianceSummary.scope && (
                    <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                      <strong>
                        Outside Chapter II \u2014 {data.complianceSummary.scope.citation}.
                      </strong>{' '}
                      {data.complianceSummary.scope.reason}
                    </p>
                  )}
                </section>
              )}

              <ChecklistTable
                results={data.results}
                rulePackVersion={data.rulePackVersion}
                canOverride={canAdjudicate}
                onOverride={(result) => {
                  setOverrideTarget(result);
                  setOverrideVerdict(effectiveVerdict(result));
                  setOverrideReason(result.overrideReason || '');
                }}
              />

              <p className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs leading-relaxed text-cyan-900">
                Verdicts come from the deterministic rule pack applied to the extracted
                declarations \u2014 the model read the label, code decided the outcome. Rules
                prescribing a measurement in millimetres (7(2), 7(3), 8(1)) and the 9(1)(b)
                contrast ratio read <strong>Not assessed</strong>: this path reads the label
                but does not measure it.
              </p>
            </div>
          )}

          {activeTab === 'checklist' && isExtractionMode && (
            <ExtractionReport report={data.extractionReport} />
          )}

          {activeTab === 'checklist' && !isExtractionMode && (
            <ChecklistTable
              results={data.results}
              rulePackVersion={data.rulePackVersion}
              canOverride={canAdjudicate}
              onOverride={(result) => {
                setOverrideTarget(result);
                setOverrideVerdict(effectiveVerdict(result));
                setOverrideReason(result.overrideReason || '');
              }}
            />
          )}

          {activeTab === 'declarations' && <DeclarationTable extracted={data.extracted} />}

          {activeTab === 'tokens' && (
            <OcrTokenTable tokens={data.ocrTokens ?? []} engine={additional?.ocrEngine} />
          )}
        </div>

        <div className="flex flex-col gap-6">
          {!isExtractionMode && (
          <MeasurementPanel
            measurements={additional?.visionMeasurements}
            engine={additional?.ocrEngine}
            warnings={additional?.visionWarnings}
          />
          )}

          {!isExtractionMode && (
          <SpellCheckPanel
            result={spellRow?.spellCheck}
            found={spellRow?.found}
            note={spellRow?.note}
          />
          )}

          {data.remarks && (
            <section className="card p-5">
              <h2 className="section-title mb-2">Adjudication remarks</h2>
              <p className="text-sm text-slate-700">{data.remarks}</p>
            </section>
          )}
        </div>
      </div>

      {/* Override dialog */}
      <Modal
        isOpen={!!overrideTarget}
        onClose={() => setOverrideTarget(null)}
        title={`Override ${overrideTarget?.citation || overrideTarget?.ruleId || ''}`}
        description="Overrides are recorded against your account in the audit trail."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!overrideTarget) return;
            await runAction('override', () =>
              inspectionService.override(data._id, {
                ruleId: overrideTarget.ruleId,
                overrideVerdict,
                overrideReason,
              })
            );
            setOverrideTarget(null);
          }}
        >
          {overrideTarget?.measuredValue && (
            <div className="rounded-lg border border-cyan-100 bg-cyan-50/60 p-3 text-sm">
              <p className="text-cyan-950">
                Measured <span className="font-mono">{overrideTarget.measuredValue}</span>
                {overrideTarget.prescribedValue && (
                  <>
                    {' '}against <span className="font-mono">{overrideTarget.prescribedValue}</span>
                  </>
                )}
              </p>
              {overrideTarget.note && (
                <p className="mt-1 text-xs italic text-slate-600">{overrideTarget.note}</p>
              )}
            </div>
          )}

          <div>
            <label htmlFor="overrideVerdict" className="label">
              Officer verdict
            </label>
            <select
              id="overrideVerdict"
              value={overrideVerdict}
              onChange={(e) => setOverrideVerdict(e.target.value as RuleVerdict)}
              className="input"
            >
              <option value="PASS">Pass</option>
              <option value="FAIL">Fail</option>
              <option value="REVIEW">Needs review</option>
              <option value="NOT_APPLICABLE">Not applicable</option>
            </select>
          </div>

          <div>
            <label htmlFor="overrideReason" className="label">
              Reason (minimum 10 characters)
            </label>
            <textarea
              id="overrideReason"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              rows={3}
              required
              minLength={10}
              className="input resize-none"
              placeholder="Explain why the automated verdict is being changed…"
            />
          </div>

          <div className="flex justify-end gap-3 border-t border-cyan-100 pt-4">
            <Button type="button" variant="secondary" onClick={() => setOverrideTarget(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={busy === 'override'}
              disabled={overrideReason.trim().length < 10}
            >
              Record override
            </Button>
          </div>
        </form>
      </Modal>

      {/* Adjudication dialog */}
      <Modal
        isOpen={adjudicateOpen}
        onClose={() => setAdjudicateOpen(false)}
        title="Adjudicate inspection"
        description="This closes the automated stage and records the officer's final verdict."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await runAction('adjudicate', () =>
              inspectionService.adjudicate(data._id, { verdict: adjudicateVerdict, remarks })
            );
            setAdjudicateOpen(false);
          }}
        >
          {summary.review > 0 && (
            <div className="rounded-lg border border-verdict-review/25 bg-verdict-review/5 p-3 text-sm text-verdict-review">
              {summary.review} row{summary.review === 1 ? '' : 's'} still read “needs review”. Those
              are the checks the system declined to decide; look at them before closing the case.
            </div>
          )}

          <div>
            <label htmlFor="verdict" className="label">
              Final verdict
            </label>
            <select
              id="verdict"
              value={adjudicateVerdict}
              onChange={(e) => setAdjudicateVerdict(e.target.value)}
              className="input"
            >
              <option value="compliant">Compliant</option>
              <option value="non_compliant">Non-compliant</option>
              <option value="review">Keep under review</option>
            </select>
          </div>

          <div>
            <label htmlFor="remarks" className="label">
              Remarks
            </label>
            <textarea
              id="remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={4}
              className="input resize-none"
              placeholder="Findings, statutory basis and any direction issued…"
            />
          </div>

          <div className="flex justify-end gap-3 border-t border-cyan-100 pt-4">
            <Button type="button" variant="secondary" onClick={() => setAdjudicateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={busy === 'adjudicate'}>
              Record verdict
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

/**
 * useSearchParams (used for the `?from=` back target) must sit inside a
 * Suspense boundary or `next build` refuses to prerender the route.
 */
export default function ResultsPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--app-bg)]" />}>
      <ResultsPageInner params={params} />
    </Suspense>
  );
}
