export function amountScale(values: readonly number[]): number {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return sorted[index];
}

export function amountBarRatio(value: number, scale: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(scale) || scale <= 0) return 0;
  return Math.min(1, value / scale);
}

export function formatTradingAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return '--';
  if (value >= 100_000_000) return `${compact(value / 100_000_000)}亿`;
  if (value >= 10_000) return `${compact(value / 10_000)}万`;
  return `${Math.round(value)}元`;
}

export function formatTurnoverRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return '--';
  return `${value.toFixed(2)}%`;
}

function compact(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return value.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0$/, '');
}
