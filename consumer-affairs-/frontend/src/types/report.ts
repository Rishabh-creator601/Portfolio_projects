/** Formats a stored JSON report can be rendered into on download. */
export type ReportFormat = 'pdf' | 'docx' | 'xlsx' | 'json';

/** The inspection-level verdict vocabulary (distinct from per-rule verdicts). */
export type ReportVerdict = 'compliant' | 'non_compliant' | 'review' | 'draft';

/** Counts frozen into the payload at issue time, so lists need no recompute. */
export interface ReportSummary {
  ref: string | null;
  verdict: ReportVerdict | null;
  status: string | null;
  productLabel: string;
  ruleCount: number;
  failedRules: number;
  penaltyTotal: number;
}

/**
 * One report as the repository list sees it. The full JSON payload is not
 * included here - it is fetched per report, or downloaded rendered.
 */
export interface StoredReport {
  _id: string;
  inspectionId: string | { _id: string; ref?: string };
  inspectionRef: string | null;
  productLabel: string | null;
  verdict: ReportVerdict | null;
  format: 'json' | 'pdf' | 'docx' | 'xlsx';
  hash: string | null;
  issuedAt: string;
  issuedBy: string | { _id: string; displayName?: string } | null;
  ownerId: string | null;
  kind?: 'compliance' | 'extraction';
  summary: ReportSummary | null;
  /** Empty for legacy GridFS records, which only exist in their stored format. */
  availableFormats: ReportFormat[];
  qrToken?: string;
  verifyUrl?: string;
}
