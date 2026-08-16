import { describe, expect, it } from 'vitest';
import {
  chartLayout,
  formatChangePercent,
  formatPriceScaleLabel,
  splitPriceSegments,
  symmetricPriceRange,
  tradingSessionProgress
} from '../src/background/chart-geometry';

describe('chart geometry', () => {
  it('keeps the price range symmetric around previous close', () => {
    const range = symmetricPriceRange([99, 100, 103], 100);
    expect(100 - range.min).toBeCloseTo(range.max - 100);
    expect(range.max).toBeGreaterThan(103);
  });

  it('maps A-share trading sessions to a fixed 240-minute axis', () => {
    expect(tradingSessionProgress('2026-08-17 09:30')).toBe(0);
    expect(tradingSessionProgress('2026-08-17 10:30')).toBe(0.25);
    expect(tradingSessionProgress('2026-08-17 11:30')).toBe(0.5);
    expect(tradingSessionProgress('2026-08-17 13:30')).toBe(0.625);
    expect(tradingSessionProgress('2026-08-17 15:00')).toBe(1);
  });

  it('splits a price segment when it crosses the zero line', () => {
    const segments = splitPriceSegments([99, 101], [0, 1], 100);
    expect(segments).toEqual([
      { fromPosition: 0, toPosition: 0.5, fromPrice: 99, toPrice: 100, direction: 'down' },
      { fromPosition: 0.5, toPosition: 1, fromPrice: 100, toPrice: 101, direction: 'up' }
    ]);
  });

  it('formats the latest change percentage', () => {
    expect(formatChangePercent(100.51, 100)).toBe('+0.51%');
    expect(formatChangePercent(99.49, 100)).toBe('-0.51%');
    expect(formatChangePercent(100, 100)).toBe('0.00%');
  });

  it('formats price and percentage for scale labels', () => {
    expect(formatPriceScaleLabel(121.27, 120.66)).toBe('121.27  +0.51%');
    expect(formatPriceScaleLabel(120.66, 120.66)).toBe('120.66  0.00%');
  });

  it('keeps the scale gutter to the left of the minimap', () => {
    const layout = chartLayout(1400, 1300);
    expect(layout).toEqual({ chartWidth: 1182, scaleLeft: 1190, scaleRight: 1294, showScale: true });
    expect(layout.scaleRight).toBeLessThan(1300);
  });

  it('hides the scale gutter in narrow editors', () => {
    expect(chartLayout(400).showScale).toBe(false);
  });
});
