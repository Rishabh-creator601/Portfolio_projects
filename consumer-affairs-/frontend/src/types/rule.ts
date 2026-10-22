export interface Rule {
  id: string;
  citation: string;
  subject: string;
  description: string;
  /** How the check is machine-tested - the validation matrix column. */
  method?: string;
  severity: 'critical' | 'major' | 'minor';
  penaltyAmount: number;
  automationLevel: 'full' | 'assisted' | 'flagged';
  applicability?: { excludeCategories?: string[]; scope?: string };
}

export interface RulePack {
  version: string;
  effectiveFrom: string;
  isActive: boolean;
  rules: Rule[];
}
