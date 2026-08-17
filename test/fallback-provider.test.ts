import { describe, expect, it } from 'vitest';
import type { IntradayPoint, MarketDataProvider, StockQuote, StockRef } from '../src/domain/types';
import { TencentPrimaryProvider } from '../src/market/fallback-provider';
import { createStockRef } from '../src/market/stock-code';

const stockA = createStockRef('600519');
const stockB = createStockRef('000001');

function quote(stock: StockRef): StockQuote {
  return { ...stock, name: stock.code, price: 10, previousClose: 9, change: 1, changePercent: 11.11, volume: 10, amount: 1000, turnoverRate: 0.5, suspended: false };
}

function point(amount: number): IntradayPoint {
  return { time: '2026-08-17 09:30', price: 10, averagePrice: 10, volume: 1, amount };
}

class StubProvider implements MarketDataProvider {
  constructor(private readonly quotes: StockQuote[], private readonly points: IntradayPoint[], private readonly fail = false) {}
  async fetchQuotes(): Promise<StockQuote[]> { if (this.fail) throw new Error('stub quote failure'); return this.quotes; }
  async fetchIntraday(): Promise<IntradayPoint[]> { if (this.fail) throw new Error('stub intraday failure'); return this.points; }
}

describe('TencentPrimaryProvider', () => {
  it('fills incomplete Tencent quotes from East Money without replacing valid rows', async () => {
    const logs: string[] = [];
    const provider = new TencentPrimaryProvider(new StubProvider([quote(stockA)], []), new StubProvider([quote(stockB)], []), logs.push.bind(logs));
    const quotes = await provider.fetchQuotes([stockA, stockB]);
    expect(quotes.map((item) => item.code)).toEqual(['600519', '000001']);
    expect(logs.at(-1)).toContain('East Money');
  });

  it('falls back to East Money when Tencent intraday is empty', async () => {
    const logs: string[] = [];
    const provider = new TencentPrimaryProvider(new StubProvider([quote(stockA)], []), new StubProvider([quote(stockA)], [point(200)]), logs.push.bind(logs));
    await expect(provider.fetchIntraday(stockA)).resolves.toEqual([point(200)]);
    expect(logs.at(-1)).toContain('intraday source: East Money');
  });
});
