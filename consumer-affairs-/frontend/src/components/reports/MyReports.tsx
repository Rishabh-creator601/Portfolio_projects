'use client';

import React, { useState } from 'react';
import { FileDown, FileJson, FileText, Inbox } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { reportService } from '@/lib/services';
import { useApi } from '@/lib/hooks';
import { formatDate } from '@/lib/constants';
import { SearchBar } from '@/components/ui/SearchBar';
import type { ReportFormat, StoredReport } from '@/types/report';

const VERDICT_STYLES: Record<string, string> = {
  compliant: 'border-verdict-pass/30 bg-verdict-pass/10 text-verdict-pass',
  non_compliant: 'border-verdict-fail/30 bg-verdict-fail/10 text-verdict-fail',
  review: 'border-verdict-review/30 bg-verdict-review/10 text-verdict-review',
  draft: 'border-verdict-na/30 bg-verdict-na/10 text-verdict-na',
};

const VERDICT_LABELS: Record<string, string> = {
  compliant: 'Compliant',
  non_compliant: 'Non-compliant',
  review: 'Review',
  draft: 'Draft',
};

/**
 * The officer's own reports. Each row is a JSON document in MongoDB; the PDF is
 * rendered from that payload only when someone asks for it, so the list and the
 * download can never disagree about what the report says.
 */
export function MyReports() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reports = useApi(() => reportService.mine({ search, page, limit: 20 }), [search, page]);

  const rows: StoredReport[] = reports.data?.data ?? [];
  const meta = reports.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  const download = async (report: StoredReport, format: ReportFormat) => {
    setBusy(`${report._id}:${format}`);
    setError(null);

    try {
      const response = await api.get(reportService.downloadUrl(report._id, format), {
        responseType: 'blob',
      });

      const url = URL.createObjectURL(response.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${report.inspectionRef || 'LM-Verify-report'}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'The report could not be downloaded. Try again.'
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="section-title">My reports</h2>
          <p className="mt-1 text-xs text-slate-500">
            Stored as JSON and rendered to PDF on download.
            {meta ? ` ${meta.total} total.` : ''}
          </p>
        </div>
        <div className="w-full sm:w-72">
          <SearchBar
            onSearch={(v: string) => {
              setPage(1);
              setSearch(v);
            }}
            placeholder="Search by reference or product…"
          />
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-verdict-fail/25 bg-verdict-fail/5 px-3 py-2 text-sm text-verdict-fail">
          {error}
        </p>
      )}

      {reports.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-16 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center">
          <Inbox className="mx-auto h-8 w-8 text-cyan-300" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-cyan-950">No reports yet</p>
          <p className="mt-1 text-xs text-slate-500">
            Reports you generate from an inspection are filed here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-cyan-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2 pr-4 font-medium">Reference</th>
                <th className="pb-2 pr-4 font-medium">Product</th>
                <th className="pb-2 pr-4 font-medium">Verdict</th>
                <th className="pb-2 pr-4 font-medium">Issued</th>
                <th className="pb-2 text-right font-medium">Download</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyan-50">
              {rows.map((report) => (
                <tr key={report._id} className="align-middle">
                  <td className="py-3 pr-4">
                    <span className="font-mono text-xs text-cyan-900">
                      {report.inspectionRef || '—'}
                    </span>
                    {report.summary && report.summary.penaltyTotal > 0 && (
                      <p className="mt-0.5 text-xs text-verdict-fail">
                        ₹{report.summary.penaltyTotal.toLocaleString('en-IN')} exposure
                      </p>
                    )}
                  </td>

                  <td className="py-3 pr-4">
                    <span className="text-cyan-950">{report.productLabel || '—'}</span>
                    {report.summary && report.summary.ruleCount > 0 && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {report.summary.failedRules} of {report.summary.ruleCount} rules failed
                      </p>
                    )}
                  </td>

                  <td className="py-3 pr-4">
                    {report.verdict ? (
                      <span className={`chip ${VERDICT_STYLES[report.verdict] || ''}`}>
                        {VERDICT_LABELS[report.verdict] || report.verdict}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>

                  <td className="py-3 pr-4 text-xs text-slate-500">{formatDate(report.issuedAt)}</td>

                  <td className="py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => download(report, 'pdf')}
                        disabled={busy !== null}
                        title="Download as PDF, rendered from the stored JSON"
                        className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-cyan-300 bg-white px-3 py-1.5 text-xs font-medium text-cyan-800 transition-colors hover:bg-cyan-50 disabled:opacity-50"
                      >
                        {busy === `${report._id}:pdf` ? (
                          <svg
                            className="h-3.5 w-3.5 animate-spin"
                            fill="none"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                        ) : (
                          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        PDF
                      </button>

                      <button
                        type="button"
                        onClick={() => download(report, 'json')}
                        disabled={busy !== null}
                        title="Download the stored JSON record"
                        className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-cyan-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-cyan-50 hover:text-cyan-800 disabled:opacity-50"
                      >
                        <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
                        JSON
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && totalPages > 1 && (
        <div className="mt-5 flex items-center justify-between border-t border-cyan-100 pt-4">
          <p className="text-xs text-slate-500">
            Page {meta.page ?? page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="focus-ring rounded-lg border border-cyan-200 px-3 py-1.5 text-xs font-medium text-cyan-800 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages}
              className="focus-ring rounded-lg border border-cyan-200 px-3 py-1.5 text-xs font-medium text-cyan-800 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
        <FileDown className="h-3 w-3" aria-hidden="true" />
        PDFs are generated at download time from the JSON record in MongoDB — no document files are
        stored.
      </p>
    </section>
  );
}

export default MyReports;
