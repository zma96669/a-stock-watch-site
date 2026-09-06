/**
 * Transparent retail-account proxy calculations.
 * These functions intentionally avoid presenting shareholder accounts as an
 * exact count of people: one investor may have multiple accounts and public
 * reports do not classify every account as retail or institutional.
 */

export function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
export function estimateRetailAccounts({
  shareholderAccounts,
  identifiableInstitutionAccounts = 0,
  identifiableCorporateAccounts = 0,
  top10NonRetailAccounts = 0
}) {
  const total = finiteNumber(shareholderAccounts);
  if (total === undefined || total < 0) return undefined;
  const excluded = [identifiableInstitutionAccounts, identifiableCorporateAccounts, top10NonRetailAccounts]
    .map(finiteNumber)
    .filter((value) => value !== undefined && value >= 0)
    .reduce((sum, value) => sum + value, 0);
  return Math.max(0, Math.round(total - excluded));
}

export function buildRetailEstimate(input) {
  const shareholderAccounts = finiteNumber(input.shareholderAccounts);
  const estimatedRetailAccounts = estimateRetailAccounts(input);
  if (shareholderAccounts === undefined || estimatedRetailAccounts === undefined) return undefined;
  const identifiableInstitutionAccounts = nonNegative(input.identifiableInstitutionAccounts);
  const identifiableCorporateAccounts = nonNegative(input.identifiableCorporateAccounts);
  const top10NonRetailAccounts = nonNegative(input.top10NonRetailAccounts);
  const excluded = shareholderAccounts - estimatedRetailAccounts;
  const hasIdentifiedNonRetail = excluded > 0;
  return {
    shareholderAccounts: Math.round(shareholderAccounts),
    estimatedRetailAccounts,
    estimatedRetailRatio: shareholderAccounts > 0 ? estimatedRetailAccounts / shareholderAccounts : undefined,
    identifiableNonRetailAccounts: Math.max(0, Math.round(excluded)),
    identifiableInstitutionAccounts,
    identifiableCorporateAccounts,
    top10NonRetailAccounts,
    estimateMethod: hasIdentifiedNonRetail
      ? '股东户数减去已识别的非散户账户'
      : '股东户数代理值（未获得完整机构账户明细）',
    confidence: hasIdentifiedNonRetail ? 'B' : 'C'
  };
}

function nonNegative(value) {
  const number = finiteNumber(value);
  return number !== undefined && number >= 0 ? Math.round(number) : 0;
}

export function pearsonCorrelation(left, right) {
  const pairs = left.map((value, index) => [finiteNumber(value), finiteNumber(right[index])])
    .filter(([a, b]) => a !== undefined && b !== undefined);
  if (pairs.length < 4) return undefined;
  const meanA = pairs.reduce((sum, [a]) => sum + a, 0) / pairs.length;
  const meanB = pairs.reduce((sum, [, b]) => sum + b, 0) / pairs.length;
  let numerator = 0;
  let denominatorA = 0;
  let denominatorB = 0;
  for (const [a, b] of pairs) {
    const da = a - meanA;
    const db = b - meanB;
    numerator += da * db;
    denominatorA += da * da;
    denominatorB += db * db;
  }
  const denominator = Math.sqrt(denominatorA * denominatorB);
  return denominator > 0 ? numerator / denominator : undefined;
}
