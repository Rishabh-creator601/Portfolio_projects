'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, FileType } from 'lucide-react';
import { api } from '@/lib/api';
import { reportService } from '@/lib/services';
import { ApiError } from '@/lib/api';

interface ReportDownloaderProps {
  inspectionId: string;
  inspectionRef?: string;
  /**
   * Extraction mode produces a record of a reading, not a document meant to be
   * edited afterwards, so DOCX is not offered for it.
   */
  extractionOnly?: boolean;
}

const FORMATS = [
  { key: 'pdf' as const, label: 'PDF certificate', icon: FileText },
  { key: 'docx' as const, label: 'DOCX (editable)', icon: FileType },
  { key: 'xlsx' as const, label: 'XLSX (data)', icon: FileSpreadsheet },
];

export function ReportDownloader({
  inspectionId,
  inspectionRef,
  extractionOnly = false,
}: ReportDownloaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loadingFormat, setLoadingFormat] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onClickAway = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [isOpen]);

  const handleDownload = async (format: 'pdf' | 'docx' | 'xlsx') => {
    setLoadingFormat(format);
    setError(null);

    try {
      // Persist the report as JSON once, then ask the API to render that stored
      // payload into the requested format. Nothing binary is kept server-side.
      const report = await reportService.generate(inspectionId);
      const response = await api.get(reportService.downloadUrl(report._id, format), {
        responseType: 'blob',
      });

      const url = URL.createObjectURL(response.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${inspectionRef || 'LM-Verify-report'}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setIsOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The report could not be generated.');
    } finally {
      setLoadingFormat(null);
    }
  };

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="focus-ring inline-flex items-center gap-2 rounded-lg border border-cyan-300 bg-white px-4 py-2 text-sm font-medium text-cyan-800 transition-colors hover:bg-cyan-50"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {extractionOnly ? 'Download extraction report' : 'Download report'}
        <ChevronDown className="h-4 w-4 opacity-60" aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="animate-fade-in absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-lg border border-cyan-200 bg-white shadow-card-hover"
        >
          {FORMATS.filter((f) => !(extractionOnly && f.key === 'docx')).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              role="menuitem"
              onClick={() => handleDownload(key)}
              disabled={loadingFormat !== null}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-cyan-50 hover:text-cyan-900 disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2">
                <Icon className="h-4 w-4 text-cyan-600" aria-hidden="true" />
                {label}
              </span>
              {loadingFormat === key && (
                <svg className="h-4 w-4 animate-spin text-cyan-bright" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              )}
            </button>
          ))}

          {error && (
            <p className="border-t border-cyan-100 bg-verdict-fail/5 px-4 py-2 text-xs text-verdict-fail">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default ReportDownloader;
