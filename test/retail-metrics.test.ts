import { beforeAll, describe, expect, it } from 'vitest';

let buildRetailEstimate: (input: any) => any;
let estimateRetailAccounts: (input: any) => number | undefined;
let pearsonCorrelation: (left: unknown[], right: unknown[]) => number | undefined;

describe('retail estimate metrics', () => {
  beforeAll(async () => {
    ({ buildRetailEstimate, estimateRetailAccounts, pearsonCorrelation } = await import('../scripts/retail-metrics.mjs'));
  });

  it('uses shareholder accounts as a transparent C-grade proxy when no breakdown exists', () => {
    expect(buildRetailEstimate({ shareholderAccounts: 125000 })).toMatchObject({
      estimatedRetailAccounts: 125000,
      estimatedRetailRatio: 1,
      confidence: 'C'
    });
  });

  it('subtracts only non-negative, identifiable non-retail accounts', () => {
    expect(estimateRetailAccounts({
      shareholderAccounts: 100,
      identifiableInstitutionAccounts: 12,
      identifiableCorporateAccounts: 8,
      top10NonRetailAccounts: -5
    })).toBe(80);
  });

  it('rejects invalid or underspecified account counts', () => {
    expect(estimateRetailAccounts({ shareholderAccounts: 'n/a' })).toBeUndefined();
    expect(estimateRetailAccounts({ shareholderAccounts: 10 })).toBe(10);
    expect(buildRetailEstimate({ shareholderAccounts: -1 })).toBeUndefined();
  });

  it('returns Pearson correlation only when there is enough variation', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearsonCorrelation([1, 1, 1, 1], [2, 3, 4, 5])).toBeUndefined();
    expect(pearsonCorrelation([1, 2, 3], [2, 4, 6])).toBeUndefined();
  });
});
