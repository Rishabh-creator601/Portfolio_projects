export interface ComplianceHistoryEntry {
  inspectionId: string;
  verdict: 'compliant' | 'non_compliant' | 'review' | 'draft';
  date: string;
  violations: number;
  ref?: string;
}

export interface Product {
  _id: string;
  gtin?: string;
  brand: string;
  genericName: string;
  category: string;
  imageHash?: string;
  complianceHistory: ComplianceHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}
