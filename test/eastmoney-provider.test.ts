import { describe, expect, it } from 'vitest';
import { parseQuoteResponse, parseTrendResponse } from '../src/market/eastmoney-provider';
import { createStockRef } from '../src/market/stock-code';

describe('EastMoney parser', () => {
  it('parses quote fields', () => {
    const stock = createStockRef('600519');
    const [quote] = parseQuoteResponse({ data: { diff: [{ f12: '600519', f14: '贵州茅台', f2: 1500.25, f3: 1.2, f4: 17.8, f5: 1234, f6: 2000000, f8: 0.83, f18: 1482.45 }] } }, [stock]);
    expect(quote.name).toBe('贵州茅台');
    expect(quote.price).toBe(1500.25);
    expect(quote.changePercent).toBe(1.2);
    expect(quote.turnoverRate).toBe(0.83);
    expect(quote.suspended).toBe(false);
  });
  it('parses trend rows and ignores malformed rows', () => {
    const points = parseTrendResponse({ data: { trends: ['2026-08-16 09:30,10.10,10.05,10.10,10.00,123,12423.00,10.05', 'broken'] } });
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ price: 10.05, averagePrice: 10.05, volume: 123 });
  });
});
