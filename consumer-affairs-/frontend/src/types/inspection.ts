export interface OcrToken {
  text: string;
  bbox: number[];
  confidence: number;
  panel?: string;
  /** Devanagari, Latin or both - the Rule 9(4) signal. */
  script?: string;
}

export interface ExtractedDeclarations {
  manufacturer?: { name?: string | null; address?: string | null; qualifier?: string | null };
  genericName?: string | null;
  netQuantity?: { value?: number | null; unit?: string | null; raw?: string | null };
  monthYear?: { month?: string | number | null; year?: string | number | null; raw?: string | null };
  mrp?: { value?: number | null; wording?: string | null; raw?: string | null };
  consumerCare?: {
    name?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  dimensions?: string | null;
  additionalInfo?: {
    rawText?: string;
    hasWhenPackedQualifier?: boolean;
    confidence?: Record<string, number>;
    panel?: string;
    isBlownOrMoulded?: boolean;
    hasStickerOverMRP?: boolean;
    detectedScripts?: string[];
    tokenConfidences?: number[];
    ocrEngine?: string | null;
    imageHash?: string | null;
    visionMeasurements?: VisionMeasurements | null;
    visionWarnings?: string[];
  };
}

/** Physical measurements returned by the vision sidecar. */
export interface VisionMeasurements {
  quality?: {
    blur_score: number;
    is_blurred: boolean;
    glare_ratio: number;
    has_glare: boolean;
    accepted: boolean;
    warnings?: string[];
  } | null;
  calibration?: {
    mm_per_px: number | null;
    source: string;
    confidence: string;
    is_curved_surface?: boolean;
    perspective_corrected?: boolean;
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

/** Client extraction report produced by the Gemini path. */
export interface ExtractionReport {
  summary: {
    product: string;
    brand?: string | null;
    packageType?: string | null;
    packageMaterial?: string | null;
    declarationsFound: number;
    declarationsTotal: number;
    completenessPercent: number;
    extractionConfidence?: number | null;
    regionsDetected: number;
    imageHash?: string | null;
    model?: string | null;
    processingTimeMs?: number | null;
  };
  declarations: Array<{
    key: string;
    citation: string;
    label: string;
    value: string | null;
    status: 'found' | 'not_found';
  }>;
  fssai: Array<{ key: string; label: string; value: unknown; status: 'found' | 'not_found' }>;
  nutrition?: Record<string, any> | null;
  package?: {
    type?: string | null;
    material?: string | null;
    is_curved_surface?: boolean | null;
    is_blown_or_moulded?: boolean | null;
  } | null;
  detections: Array<{
    region: string;
    box?: { x: number; y: number; width: number; height: number };
    box_2d?: number[];
    text?: string | null;
  }>;
  legibilityIssues?: string[];
  notes?: string | null;
  disclaimer?: string;
}

/** Spelling advisory attached to the SPELL checklist row. */
export interface SpellCheckResult {
  misspellings: Array<{
    word: string;
    original?: string;
    position: number;
    suggestions: string[];
    certainty: 'high' | 'medium' | 'low';
  }>;
  score: number;
  checkedWords: number;
  likelyOCRError: boolean;
}

export type Verdict = 'compliant' | 'non_compliant' | 'review' | 'draft' | 'not_applicable';
export type RuleVerdict = 'PASS' | 'FAIL' | 'REVIEW' | 'NOT_APPLICABLE' | 'NOT_ASSESSED';
export type InspectionStatus =
  | 'draft'
  | 'extracted'
  | 'under_review'
  | 'adjudicated'
  | 'notice_issued'
  | 'closed';

export interface ComplianceResult {
  _id?: string;
  ruleId: string;
  citation?: string;
  check?: string;
  found?: string;
  required?: string;
  verdict: RuleVerdict;
  confidence?: number | string;
  measuredValue?: string;
  prescribedValue?: string;
  overridden?: boolean;
  overrideVerdict?: RuleVerdict;
  overrideReason?: string;
  overrideAt?: string;
  /** Explains a REVIEW verdict, or the caveat behind a PASS/FAIL. */
  note?: string | null;
  /** Present only on the advisory SPELL row. */
  spellCheck?: SpellCheckResult;
}

export interface PopulatedRef {
  _id: string;
  displayName?: string;
  email?: string;
  role?: string;
  jurisdiction?: string;
  brand?: string;
  genericName?: string;
  category?: string;
}

export interface Inspection {
  _id: string;
  ref: string;
  officerId?: string | PopulatedRef;
  productId?: string | PopulatedRef | null;
  geo?: { lat?: number; lng?: number };
  capturedAt?: string;
  images?: unknown[];
  ocrTokens?: OcrToken[];
  extracted?: ExtractedDeclarations;
  results: ComplianceResult[];
  verdict: Verdict;
  status: InspectionStatus;
  rulePackVersion?: string;
  remarks?: string;
  penalties?: { total: number; breakdown: Array<{ ruleId: string; amount: number }> };
  attachments?: unknown[];
  /** Present when the inspection was read by the Gemini extraction path. */
  extractionReport?: ExtractionReport | null;
  /** Counts, resolved category and scope-gate outcome for the evaluated rows. */
  complianceSummary?: {
    total: number;
    passed: number;
    failed: number;
    review: number;
    notApplicable: number;
    notAssessed: number;
    category: string;
    categoryName?: string;
    categoryMatchedOn?: string | null;
    categoryConfidence?: string;
    categoryNote?: string;
    inScope?: boolean;
    scope?: { citation?: string; reason?: string };
    rulePackVersion?: string;
  } | null;
  createdAt: string;
  updatedAt?: string;
}
