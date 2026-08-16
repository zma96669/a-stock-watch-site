import { describe, expect, it } from 'vitest';
import type { IntradayPoint, MarketDataProvider, StockQuote, StockRef } from '../src/domain/types';
import { createStockRef } from '../src/market/stock-code';
import { QuoteService } from '../src/services/quote-service';

class FakeProvider implements MarketDataProvider {
  fail = false;
  async fetchQuotes(stocks: StockRef[]): Promise<StockQuote[]> {
    if (this.fail) throw new Error('offline');
    return stocks.map((stock) => ({ ...stock, name: '测试股票', price: 10, previousClose: 9.5, change: .5, changePercent: 5.26, volume: 100, amount: 1000, suspended: false }));
  }
  async fetchIntraday(): Promise<IntradayPoint[]> {
    if (this.fail) throw new Error('offline');
    return [{ time: '2026-08-16 09:30', price: 10, averagePrice: 9.9, volume: 100, amount: 1000 }];
  }
}

describe('QuoteService', () => {
  it('publishes one shared snapshot and preserves it on failure', async () => {
    const provider = new FakeProvider();
    const stock = createStockRef('600519', '测试股票');
    const service = new QuoteService(provider, () => [stock], () => stock.code, () => 5);
    await service.refreshNow();
    expect(service.getSnapshot().quotes[stock.code].price).toBe(10);
    expect(service.getSnapshot().intraday).toHaveLength(1);
    provider.fail = true;
    await service.refreshNow();
    expect(service.getSnapshot().stale).toBe(true);
    expect(service.getSnapshot().quotes[stock.code].price).toBe(10);
  });
});
