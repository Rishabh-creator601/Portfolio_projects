import type { UserRole } from '@/types/user';

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

export const ROLE_LABELS: Record<string, string> = {
  field_inspector: 'Field Inspector',
  senior_inspector: 'Senior Inspector',
  controller: 'Controller / Admin',
  legal_officer: 'Legal Officer',
  auditor: 'Auditor',
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  field_inspector: 'Captures packages and raises inspections in the field',
  senior_inspector: 'Reviews extractions, overrides verdicts and adjudicates',
  controller: 'Full administrative control including user provisioning',
  legal_officer: 'Maintains versioned rule packs and statutory citations',
  auditor: 'Read-only access to inspections and the audit trail',
};

/** Verdict colours are reserved and must never be reused for branding. */
export const VERDICT_STYLES: Record<string, { label: string; className: string; dot: string }> = {
  PASS: {
    label: 'Pass',
    className: 'bg-verdict-pass/10 text-verdict-pass border-verdict-pass/25',
    dot: 'bg-verdict-pass',
  },
  FAIL: {
    label: 'Fail',
    className: 'bg-verdict-fail/10 text-verdict-fail border-verdict-fail/25',
    dot: 'bg-verdict-fail',
  },
  REVIEW: {
    label: 'Review',
    className: 'bg-verdict-review/10 text-verdict-review border-verdict-review/25',
    dot: 'bg-verdict-review',
  },
  NOT_APPLICABLE: {
    label: 'Not Applicable',
    className: 'bg-slate-100 text-slate-600 border-slate-200',
    dot: 'bg-slate-400',
  },
  // Distinct from REVIEW on purpose: review means the system tried and
  // hesitated; not-assessed means this path never attempts the check.
  NOT_ASSESSED: {
    label: 'Not Assessed',
    className: 'bg-cyan-50 text-cyan-700 border-cyan-200 border-dashed',
    dot: 'bg-cyan-400',
  },
  not_applicable: {
    label: 'Out of Scope',
    className: 'bg-slate-100 text-slate-600 border-slate-200',
    dot: 'bg-slate-400',
  },
  compliant: {
    label: 'Compliant',
    className: 'bg-verdict-pass/10 text-verdict-pass border-verdict-pass/25',
    dot: 'bg-verdict-pass',
  },
  non_compliant: {
    label: 'Non-Compliant',
    className: 'bg-verdict-fail/10 text-verdict-fail border-verdict-fail/25',
    dot: 'bg-verdict-fail',
  },
  review: {
    label: 'Under Review',
    className: 'bg-verdict-review/10 text-verdict-review border-verdict-review/25',
    dot: 'bg-verdict-review',
  },
  draft: {
    label: 'Draft',
    className: 'bg-slate-100 text-slate-600 border-slate-200',
    dot: 'bg-slate-400',
  },
};

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  extracted: 'Extracted',
  under_review: 'Under Review',
  adjudicated: 'Adjudicated',
  notice_issued: 'Notice Issued',
  closed: 'Closed',
};

export const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-verdict-fail/10 text-verdict-fail border-verdict-fail/25',
  major: 'bg-verdict-review/10 text-verdict-review border-verdict-review/25',
  minor: 'bg-cyan-50 text-cyan-800 border-cyan-200',
};

export const AUTOMATION_STYLES: Record<string, string> = {
  full: 'bg-verdict-pass/10 text-verdict-pass border-verdict-pass/25',
  assisted: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  flagged: 'bg-verdict-review/10 text-verdict-review border-verdict-review/25',
};

/** Which roles may open each section of the console. */
export const ROUTE_ACCESS: Record<string, UserRole[]> = {
  '/dashboard': ['field_inspector', 'senior_inspector', 'controller', 'legal_officer', 'auditor'],
  '/scan/camera': ['field_inspector', 'senior_inspector', 'controller'],
  '/scan/upload': ['field_inspector', 'senior_inspector', 'controller'],
  '/repository': ['field_inspector', 'senior_inspector', 'controller', 'legal_officer', 'auditor'],
  '/results': ['field_inspector', 'senior_inspector', 'controller', 'legal_officer', 'auditor'],
  '/rules': ['field_inspector', 'senior_inspector', 'controller', 'legal_officer', 'auditor'],
  '/admin/users': ['controller', 'auditor'],
  // Everyone needs their own account page, whatever their role.
  '/settings': ['field_inspector', 'senior_inspector', 'controller', 'legal_officer', 'auditor'],
};

export const PASSWORD_RULES = [
  { label: 'At least 10 characters', test: (v: string) => v.length >= 10 },
  { label: 'One lowercase letter', test: (v: string) => /[a-z]/.test(v) },
  { label: 'One uppercase letter', test: (v: string) => /[A-Z]/.test(v) },
  { label: 'One number', test: (v: string) => /[0-9]/.test(v) },
  { label: 'One symbol', test: (v: string) => /[^A-Za-z0-9]/.test(v) },
];

export const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    amount || 0
  );

export const formatDate = (value?: string | Date | null) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
};

export const formatDateTime = (value?: string | Date | null) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};
