import { describe, expect, it } from 'vitest';
import { createStockRef, normalizeStockCode, toSecid } from '../src/market/stock-code';

describe('stock code', () => {
  it('normalizes optional market prefix', () => {
    expect(normalizeStockCode(' sh600519 ')).toBe('600519');
  });
  it('maps Shanghai and Shenzhen secids', () => {
    expect(toSecid('600519')).toBe('1.600519');
    expect(toSecid('000001')).toBe('0.000001');
    expect(toSecid('300750')).toBe('0.300750');
    expect(toSecid('688981')).toBe('1.688981');
  });
  it('rejects unsupported codes', () => {
    expect(() => createStockRef('123')).toThrow(/六位/);
    expect(() => createStockRef('430047')).toThrow(/暂不支持/);
  });
});

