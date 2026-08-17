import { describe, expect, it } from 'vitest';
import { createStockRef } from '../src/market/stock-code';
import { parseTencentMinuteResponse, parseTencentQuoteResponse } from '../src/market/tencent-provider';

describe('Tencent provider parser', () => {
  it('maps Tencent quote fields including amount and turnover', () => {
    const stock = createStockRef('600519');
    const fields = Array.from({ length: 39 }, () => '');
    fields[1] = '贵州茅台'; fields[2] = '600519'; fields[3] = '1293.09'; fields[4] = '1341.99';
    fields[31] = '-48.90'; fields[32] = '-3.64'; fields[36] = '78430'; fields[37] = '1011485'; fields[38] = '0.63';
    fields[35] = '1293.09/78430/10114852172';
    const [quote] = parseTencentQuoteResponse(`v_sh600519="${fields.join('~')}";`, [stock]);
    expect(quote).toMatchObject({ code: '600519', name: '贵州茅台', price: 1293.09, previousClose: 1341.99, amount: 10114852172, turnoverRate: 0.63 });
  });

  it('converts cumulative Tencent minute rows into deltas and filters after-hours rows', () => {
    const stock = createStockRef('600519');
    const payload = { data: { sh600519: { data: { date: '20260817', data: [
      '0930 10.00 100 100000.00',
      '0931 10.10 150 150500.00',
      '1130 10.20 200 201000.00',
      '1300 10.20 200 201000.00',
      '1501 10.30 300 301000.00'
    ] } } } };
    const points = parseTencentMinuteResponse(payload, stock);
    expect(points).toHaveLength(4);
    expect(points.map((point) => point.amount)).toEqual([100000, 50500, 50500, 0]);
    expect(points[1].averagePrice).toBeCloseTo(10.0333, 4);
    expect(points[3].time).toBe('2026-08-17 13:00');
  });

  it('rejects decreasing cumulative values', () => {
    const stock = createStockRef('600519');
    const payload = { data: { sh600519: { data: { date: '20260817', data: ['0930 10 100 1000', '0931 10 90 900'] } } } };
    expect(parseTencentMinuteResponse(payload, stock)).toEqual([]);
  });
});
