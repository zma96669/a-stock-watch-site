import { describe, expect, it } from 'vitest';
import { parseStockSearchResponse } from '../src/market/stock-search';

describe('stock search parser', () => {
  it('keeps only supported Shanghai and Shenzhen A shares', () => {
    const rows = parseStockSearchResponse({ QuotationCodeTable: { Data: [
      { Code: '600519', Name: '贵州茅台', MktNum: '1' },
      { Code: '000001', Name: '平安银行', MktNum: '0' },
      { Code: '00700', Name: '腾讯控股', MktNum: 'HK' },
      { Code: '510300', Name: '沪深300ETF', MktNum: '1', SecurityTypeName: '基金' }
    ] } });
    expect(rows.map((row) => [row.code, row.name])).toEqual([
      ['600519', '贵州茅台'],
      ['000001', '平安银行']
    ]);
  });
});
