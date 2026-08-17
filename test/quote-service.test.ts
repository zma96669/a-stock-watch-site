import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntradayPoint, MarketDataProvider, StockQuote, StockRef } from '../src/domain/types';
import { createStockRef } from '../src/market/stock-code';
import { QuoteService } from '../src/services/quote-service';

const stockA = createStockRef('600519', '股票A');
const stockB = createStockRef('000001', '股票B');
const stockC = createStockRef('300750', '股票C');

function quote(stock: StockRef): StockQuote {
  return { ...stock, price: 10, previousClose: 9.5, change: .5, changePercent: 5.26, volume: 100, amount: 1000, turnoverRate: .83, suspended: false };
}

function point(code: string): IntradayPoint {
  return { time: '2026-08-17 09:30', price: Number(code.slice(-2)) || 10, averagePrice: 9.9, volume: 100, amount: 1000 };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

class FakeProvider implements MarketDataProvider {
  fail = false;
  async fetchQuotes(stocks: StockRef[]): Promise<StockQuote[]> {
    if (this.fail) throw new Error('offline');
    return stocks.map((stock) => ({ ...stock, name: '测试股票', price: 10, previousClose: 9.5, change: .5, changePercent: 5.26, volume: 100, amount: 1000, turnoverRate: 0.83, suspended: false }));
  }
  async fetchIntraday(): Promise<IntradayPoint[]> {
    if (this.fail) throw new Error('offline');
    return [{ time: '2026-08-16 09:30', price: 10, averagePrice: 9.9, volume: 100, amount: 1000 }];
  }
}

describe('QuoteService', () => {
  afterEach(() => vi.useRealTimers());

  it('publishes one shared snapshot and preserves it on failure', async () => {
    const provider = new FakeProvider();
    const service = new QuoteService(provider, () => [stockA], () => stockA.code, () => 2, () => 5);
    await service.refreshNow();
    expect(service.getSnapshot().quotes[stockA.code].price).toBe(10);
    expect(service.getSnapshot().intraday).toHaveLength(1);
    provider.fail = true;
    await service.refreshNow();
    expect(service.getSnapshot().stale).toBe(true);
    expect(service.getSnapshot().quotes[stockA.code].price).toBe(10);
    expect(service.getSnapshot().intraday).toHaveLength(1);
  });

  it('clears an uncached chart immediately and aborts the previous request', async () => {
    const provider = new ControlledProvider();
    let current = stockA.code;
    const service = new QuoteService(provider, () => [stockA, stockB], () => current, () => 2, () => 5);

    service.switchCurrent();
    const first = provider.intradayRequests[0];
    current = stockB.code;
    service.switchCurrent();
    expect(first.signal.aborted).toBe(true);
    expect(service.getSnapshot()).toMatchObject({ currentCode: stockB.code, intraday: [] });

    provider.intradayRequests[1].resolve([point(stockB.code)]);
    await flush();
    expect(service.getSnapshot()).toMatchObject({ currentCode: stockB.code, intraday: [point(stockB.code)] });
  });

  it('publishes a cached chart immediately when switching back', async () => {
    const provider = new ControlledProvider();
    let current = stockA.code;
    const service = new QuoteService(provider, () => [stockA, stockB], () => current, () => 2, () => 5);

    service.switchCurrent();
    provider.intradayRequests[0].resolve([point(stockA.code)]);
    await flush();
    current = stockB.code;
    service.switchCurrent();
    current = stockA.code;
    service.switchCurrent();

    expect(service.getSnapshot()).toMatchObject({ currentCode: stockA.code, intraday: [point(stockA.code)] });
  });

  it('ignores late responses and keeps only the last rapid switch', async () => {
    const provider = new ControlledProvider();
    let current = stockA.code;
    const service = new QuoteService(provider, () => [stockA, stockB, stockC], () => current, () => 2, () => 5);

    service.switchCurrent();
    current = stockB.code;
    service.switchCurrent();
    current = stockC.code;
    service.switchCurrent();

    expect(provider.intradayRequests[0].signal.aborted).toBe(true);
    expect(provider.intradayRequests[1].signal.aborted).toBe(true);
    provider.intradayRequests[1].resolve([point(stockB.code)]);
    provider.intradayRequests[0].resolve([point(stockA.code)]);
    await flush();
    expect(service.getSnapshot()).toMatchObject({ currentCode: stockC.code, intraday: [] });

    provider.intradayRequests[2].resolve([point(stockC.code)]);
    await flush();
    expect(service.getSnapshot()).toMatchObject({ currentCode: stockC.code, intraday: [point(stockC.code)] });
  });

  it('polls quotes and intraday independently', async () => {
    vi.useFakeTimers();
    const provider = new CountingProvider();
    const service = new QuoteService(provider, () => [stockA], () => stockA.code, () => 1, () => 3);
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect([provider.quoteCalls, provider.intradayCalls]).toEqual([1, 1]);

    await vi.advanceTimersByTimeAsync(1000);
    expect([provider.quoteCalls, provider.intradayCalls]).toEqual([2, 1]);
    await vi.advanceTimersByTimeAsync(2000);
    expect([provider.quoteCalls, provider.intradayCalls]).toEqual([4, 2]);
    service.stop();
  });

  it('manual refresh requests both quote and current intraday data', async () => {
    const provider = new CountingProvider();
    const service = new QuoteService(provider, () => [stockA], () => stockA.code, () => 2, () => 5);
    await service.refreshNow();
    expect([provider.quoteCalls, provider.intradayCalls]).toEqual([1, 1]);
  });
});

interface IntradayRequest {
  signal: AbortSignal;
  resolve: (points: IntradayPoint[]) => void;
}

class ControlledProvider implements MarketDataProvider {
  readonly intradayRequests: IntradayRequest[] = [];

  async fetchQuotes(stocks: StockRef[]): Promise<StockQuote[]> {
    return stocks.map(quote);
  }

  fetchIntraday(_stock: StockRef, signal?: AbortSignal): Promise<IntradayPoint[]> {
    return new Promise((resolve) => this.intradayRequests.push({ signal: signal!, resolve }));
  }
}

class CountingProvider implements MarketDataProvider {
  quoteCalls = 0;
  intradayCalls = 0;

  async fetchQuotes(stocks: StockRef[]): Promise<StockQuote[]> {
    this.quoteCalls += 1;
    return stocks.map(quote);
  }

  async fetchIntraday(stock: StockRef): Promise<IntradayPoint[]> {
    this.intradayCalls += 1;
    return [point(stock.code)];
  }
}
