import { describe, expect, it } from 'vitest';
import { macdScale, macdSeries } from '../src/background/macd-geometry';

describe('MACD geometry', () => {
  it('calculates DIF, DEA and the doubled histogram', () => {
    const values = macdSeries([10, 11, 12, 11, 13], 2, 3, 2);
    expect(values).toHaveLength(5);
    expect(values[0]).toEqual({ dif: 0, dea: 0, histogram: 0 });
    expect(values[1]?.dif).toBeCloseTo(0.1666666667, 8);
    expect(values[1]?.dea).toBeCloseTo(0.1111111111, 8);
    expect(values[1]?.histogram).toBeCloseTo(0.1111111111, 8);
    expect(macdScale(values)).toBeGreaterThan(0);
  });

  it('keeps invalid points unrenderable without breaking the series', () => {
    const values = macdSeries([10, Number.NaN, 11]);
    expect(values).toHaveLength(3);
    expect(values[1]).toBeUndefined();
    expect(values[2]).toBeDefined();
    expect(macdSeries([1, 2], 26, 12, 9)).toEqual([]);
    expect(macdScale([undefined])).toBe(0);
  });
});
