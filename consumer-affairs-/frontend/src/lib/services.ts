import { api, del, get, getPaged, post, put } from './api';
import type { Product } from '@/types/product';
import type { Inspection } from '@/types/inspection';
import type { Rule } from '@/types/rule';
import type { User } from '@/types/user';
import type { ReportFormat, StoredReport } from '@/types/report';

export interface DashboardStats {
  totalScanned: number;
  pendingReview: number;
  totalViolations: number;
  complianceRate: number;
  penaltyExposure: number;
}

export interface TrendPoint {
  name: string;
  month: string;
  total: number;
  compliant: number;
  nonCompliant: number;
  rate: number;
}

export interface ViolationRow {
  ruleId: string;
  citation: string;
  rule: string;
  count: number;
}

export interface QueueRow {
  _id: string;
  ref: string;
  product?: string;
  reason?: string;
  officer?: string;
  verdict?: string;
  date: string;
}

export const dashboardService = {
  stats: () => get<DashboardStats>('/dashboard/stats'),
  trends: (months = 12) => get<TrendPoint[]>('/dashboard/trends', { params: { months } }),
  violations: (limit = 6) => get<ViolationRow[]>('/dashboard/violations', { params: { limit } }),
  pending: (limit = 6) => get<QueueRow[]>('/dashboard/pending', { params: { limit } }),
  recent: (limit = 6) => get<QueueRow[]>('/dashboard/recent', { params: { limit } }),
};

export const productService = {
  list: (params: { search?: string; category?: string; verdict?: string; page?: number; limit?: number }) =>
    getPaged<Product[]>('/products', { params }),
  categories: () => get<string[]>('/products/categories'),
  byId: (id: string) => get<Product>(`/products/${id}`),
  history: (id: string) => get<Inspection[]>(`/products/${id}/history`),
};

export const inspectionService = {
  list: (params: { status?: string; verdict?: string; search?: string; page?: number; limit?: number }) =>
    getPaged<Inspection[]>('/inspections', { params }),
  byId: (id: string) => get<Inspection>(`/inspections/${id}`),
  create: (body: { productId?: string; geo?: { lat: number; lng: number }; ocrTokens?: unknown[] }) =>
    post<Inspection>('/inspections', body),
  extract: (id: string, ocrTokens?: unknown[]) =>
    put<Inspection>(`/inspections/${id}/extract`, { ocrTokens }),
  /** Uploads the capture and runs the measurement pipeline against it. */
  vision: (id: string, file: File, context: CaptureContext = {}) =>
    api
      .post(`/inspections/${id}/vision`, captureForm(file, context), {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((res) => res.data.data as Inspection),
  evaluate: (id: string, body: { categoryId?: string; calibrationData?: unknown } = {}) =>
    put<Inspection>(`/inspections/${id}/evaluate`, body),
  override: (id: string, body: { ruleId: string; overrideVerdict: string; overrideReason: string }) =>
    put<Inspection>(`/inspections/${id}/override`, body),
  adjudicate: (id: string, body: { verdict: string; remarks?: string }) =>
    put<Inspection>(`/inspections/${id}/adjudicate`, body),
  uploadAttachments: (id: string, files: File[]) => {
    const form = new FormData();
    files.forEach((file) => form.append('images', file));
    return api
      .post(`/inspections/${id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((res) => res.data.data as Inspection);
  },
};

export interface CaptureContext {
  /** Which panel the officer photographed. Rule 8 turns on this. */
  panel?: string;
  /** Width in mm of the reference card or known dimension in frame. */
  referenceWidthMm?: number;
  referenceKind?: 'reference_card' | 'known_dimension';
  /** Bottles and pouches: mm/px varies across the label. */
  isCurvedSurface?: boolean;
  /** Rule 7(2) doubles every minimum height for these. */
  isBlownOrMoulded?: boolean;
  languages?: string[];
}

export interface VisionMeasurements {
  quality?: {
    blur_score: number;
    is_blurred: boolean;
    glare_ratio: number;
    has_glare: boolean;
    accepted: boolean;
    warnings: string[];
  } | null;
  calibration?: {
    mm_per_px: number | null;
    source: string;
    confidence: string;
    is_curved_surface?: boolean;
    notes?: string[];
  } | null;
  numeral?: {
    median_digit_height_mm: number | null;
    median_letter_width_mm: number | null;
    glyph_count?: number;
    confidence: string;
    notes?: string[];
  } | null;
  contrast?: {
    ratio: number | null;
    meets_wcag_aa: boolean | null;
    confidence: string;
    notes?: string[];
  } | null;
  clearSpace?: {
    above_mm: number | null;
    below_mm: number | null;
    left_mm: number | null;
    right_mm: number | null;
    required_vertical_mm: number | null;
    required_horizontal_mm: number | null;
    satisfied: boolean | null;
    confidence: string;
    notes?: string[];
  } | null;
  panelGeometry?: { area_cm2: number | null; confidence: string } | null;
}

export interface VisionResult {
  tokens: Array<{ text: string; bbox: number[]; confidence: number; panel?: string; script?: string }>;
  engine: string;
  source: string;
  measurements: VisionMeasurements;
  imageHash?: string;
  processingTime?: number;
  warnings: string[];
}

const captureForm = (file: File, context: CaptureContext = {}) => {
  const form = new FormData();
  form.append('image', file);
  if (context.panel) form.append('panel', context.panel);
  if (context.referenceWidthMm) form.append('referenceWidthMm', String(context.referenceWidthMm));
  if (context.referenceKind) form.append('referenceKind', context.referenceKind);
  form.append('isCurvedSurface', String(Boolean(context.isCurvedSurface)));
  form.append('isBlownOrMoulded', String(Boolean(context.isBlownOrMoulded)));
  if (context.languages?.length) form.append('languages', context.languages.join(','));
  return form;
};

export const ocrService = {
  /** Full pipeline: quality gate, rectify, calibrate, read, measure. */
  analyze: (file: File, context: CaptureContext = {}) =>
    api
      .post('/ocr/analyze', captureForm(file, context), {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((res) => res.data.data as VisionResult),
  status: () =>
    get<{
      status: string;
      mode: string;
      service: string;
      version?: string;
      engines?: Array<{ name: string; available: boolean; is_default: boolean; detail: string }>;
      capabilities?: Record<string, unknown>;
    }>('/ocr/status'),
};

export const ruleService = {
  list: (params: { search?: string; severity?: string; automationLevel?: string } = {}) =>
    getPaged<Rule[]>('/rules', { params }),
  checklist: (inspectionId: string) => get<Rule[]>(`/rules/checklist/${inspectionId}`),
  categories: () => get<Array<{ id: string; name: string }>>('/rules/categories'),
};

export const userService = {
  list: (params: { role?: string; isActive?: string; search?: string } = {}) =>
    get<User[]>('/users', { params }),
  update: (id: string, body: Partial<Pick<User, 'role' | 'jurisdiction' | 'displayName' | 'isActive'>>) =>
    put<User>(`/users/${id}`, body),
  deactivate: (id: string) => del<User>(`/users/${id}`),
  create: (body: {
    email: string;
    password: string;
    role: string;
    jurisdiction: string;
    displayName: string;
  }) => post<User>('/auth/register', body),
  auditTrail: (id: string) => get<Array<Record<string, unknown>>>(`/users/${id}/audit`),
};

export const reportService = {
  /**
   * Persists the report as JSON. Format is not sent any more - one stored
   * payload is rendered into whichever format is asked for at download time.
   */
  generate: (inspectionId: string) =>
    post<StoredReport>(`/reports/generate/${inspectionId}`, {}),
  /** The signed-in officer's own reports, newest first. */
  mine: (params: { page?: number; limit?: number; search?: string; verdict?: string } = {}) =>
    getPaged<StoredReport[]>('/reports/mine', { params }),
  forInspection: (inspectionId: string) =>
    get<StoredReport[]>(`/reports/inspection/${inspectionId}`),
  downloadUrl: (reportId: string, format: ReportFormat = 'pdf') =>
    `/reports/${reportId}/download?format=${format}`,
};
