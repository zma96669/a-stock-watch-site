export interface RetailEstimateInput {
  shareholderAccounts: unknown;
  identifiableInstitutionAccounts?: unknown;
  identifiableCorporateAccounts?: unknown;
  top10NonRetailAccounts?: unknown;
}

export interface RetailEstimate {
  shareholderAccounts: number;
  estimatedRetailAccounts: number;
  estimatedRetailRatio: number | undefined;
  identifiableNonRetailAccounts: number;
  estimateMethod: string;
  confidence: 'B' | 'C';
}

export function finiteNumber(value: unknown): number | undefined;
export function estimateRetailAccounts(input: RetailEstimateInput): number | undefined;
export function buildRetailEstimate(input: RetailEstimateInput): RetailEstimate | undefined;
export function pearsonCorrelation(left: unknown[], right: unknown[]): number | undefined;
