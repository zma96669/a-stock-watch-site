import { describe, expect, it } from 'vitest';
import { amountBarRatio, amountScale, formatTradingAmount, formatTurnoverRate } from '../src/background/amount-geometry';

describe('amount background geometry', () => {
  it('uses the nearest-rank 95th percentile and clips exceptional bars', () => {
    const values = [...Array.from({ length: 19 }, (_, index) => index + 1), 1_000];
    const scale = amountScale(values);
    expect(scale).toBe(19);
    expect(amountBarRatio(9.5, scale)).toBe(0.5);
    expect(amountBarRatio(1_000, scale)).toBe(1);
    expect(amountBarRatio(Number.NaN, scale)).toBe(0);
  });

  it('formats minute amount and total turnover compactly', () => {
    expect(formatTradingAmount(9_876)).toBe('9876元');
    expect(formatTradingAmount(12_600_000)).toBe('1260万');
    expect(formatTradingAmount(832_000_000)).toBe('8.32亿');
    expect(formatTradingAmount(undefined)).toBe('--');
    expect(formatTurnoverRate(0.83)).toBe('0.83%');
    expect(formatTurnoverRate(null)).toBe('--');
  });
});
