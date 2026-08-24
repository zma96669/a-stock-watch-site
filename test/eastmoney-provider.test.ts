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
  it('keeps the Shanghai index separate from the Shenzhen stock with the same code', () => {
    const stock = createStockRef('000001', '平安银行');
    const index = { code: '000001', secid: '1.000001', market: 'SH' as const, name: '上证指数', kind: 'index' as const };
    const rows = parseQuoteResponse({ data: { diff: [
      { f12: '000001', f13: 0, f14: '平安银行', f2: 11.2, f3: 1, f4: .11, f5: 1, f6: 2, f8: .4, f18: 11.09 },
      { f12: '000001', f13: 1, f14: '上证指数', f2: 3400, f3: .5, f4: 17, f5: 3, f6: 4, f8: null, f18: 3383 }
    ] } }, [stock, index]);
    expect(rows.map((row) => [row.secid, row.name])).toEqual([['0.000001', '平安银行'], ['1.000001', '上证指数']]);
  });
  it('uses the index level for its average line', () => {
    const index = { code: '000001', secid: '1.000001', market: 'SH' as const, name: '上证指数', kind: 'index' as const };
    const points = parseTrendResponse({ data: { trends: ['2026-08-24 09:30,3900,3902.7,3903,3899,1,2,170000'] } }, index);
    expect(points[0]).toMatchObject({ price: 3902.7, averagePrice: 3902.7 });
  });
});
