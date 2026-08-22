import { describe, expect, it } from 'vitest';
import { addVolumeRatios, groupChangePercent, holdingProfit } from '../src/services/market-metrics';
import type { IntradayPoint, StockQuote, WatchlistEntry } from '../src/domain/types';

const entry = (code: string, costPrice = 10, shares = 100): WatchlistEntry => ({ code, secid: `0.${code}`, market: 'SZ', name: code, groupId: 'g', sortOrder: 0, costPrice, shares });
const quote = (item: WatchlistEntry, price: number, previousClose = 10): StockQuote => ({ ...item, price, previousClose, change: price - previousClose, changePercent: (price - previousClose) / previousClose * 100, volume: 1, amount: 1, turnoverRate: 1, suspended: false });

describe('market metrics', () => {
  it('calculates minute volume ratios from prior minutes', () => {
    const points: IntradayPoint[] = [1, 2, 4].map((volume, index) => ({ time: `09:3${index}`, price: 10, averagePrice: 10, volume, amount: volume }));
    expect(addVolumeRatios(points).map((point) => point.volumeRatio)).toEqual([undefined, 2, 2.6666666666666665]);
  });

  it('calculates weighted group change and holding profit', () => {
    const first = entry('000001');
    const second = entry('000002');
    expect(groupChangePercent([first, second], { '000001': quote(first, 11), '000002': quote(second, 9) })).toBe(0);
    expect(holdingProfit(first, quote(first, 12))).toEqual({ amount: 200, percent: 20 });
  });
});
