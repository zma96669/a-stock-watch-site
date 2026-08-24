import type { MarketIndexRef, StockRef } from '../domain/types';

export const MARKET_INDICES: readonly MarketIndexRef[] = [
  { key: 'sh000001', code: '000001', secid: '1.000001', market: 'SH', name: '上证指数', kind: 'index' },
  { key: 'sz399001', code: '399001', secid: '0.399001', market: 'SZ', name: '深证成指', kind: 'index' },
  { key: 'sz399006', code: '399006', secid: '0.399006', market: 'SZ', name: '创业板指', kind: 'index' }
];

export function marketIndex(key: string | undefined): MarketIndexRef | undefined {
  return MARKET_INDICES.find((index) => index.key === key);
}

export function instrumentKey(instrument: StockRef): string {
  return instrument.secid;
}
