import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  }
}));

import type { WatchlistEntry } from '../src/domain/types';
import { PortfolioStore } from '../src/state/portfolio-store';

const entry: WatchlistEntry = { code: '600519', secid: '1.600519', market: 'SH', name: '贵州茅台', groupId: 'default', sortOrder: 0, costPrice: 100, shares: 100 };

function harness(saved?: unknown) {
  const values = new Map<string, unknown>(saved === undefined ? [] : [['aStockWatch.portfolio', saved]]);
  const updates: Array<[string, unknown]> = [];
  const state = { get: (key: string) => values.get(key), update: vi.fn(async (key: string, value: unknown) => { values.set(key, structuredClone(value)); updates.push([key, value]); }) };
  let tick = 0;
  const writes: Array<[string, number | undefined, number | undefined]> = [];
  const store = new PortfolioStore(state as never, () => [entry], async (code, cost, shares) => { writes.push([code, cost, shares]); }, () => new Date(`2026-08-24T02:00:${String(tick++).padStart(2, '0')}.000Z`));
  return { store, values, updates, writes };
}

describe('PortfolioStore', () => {
  it('migrates legacy cost and shares and calculates weighted-average buys', async () => {
    const { store, writes } = harness();
    expect(store.getPosition('600519')).toMatchObject({ averageCost: 100, shares: 100 });
    const position = await store.buy('600519', '贵州茅台', 120, 50);
    expect(position).toMatchObject({ shares: 150, totalBuyAmount: 16000 });
    expect(position.averageCost).toBeCloseTo(106.6666666667, 8);
    expect(writes.at(-1)).toEqual(['600519', 106.66666666666667, 150]);
  });

  it('supports partial sell and archives the position after the final sell', async () => {
    const { store, writes } = harness();
    await store.sell('600519', '贵州茅台', 110, 40);
    expect(store.getPosition('600519')).toMatchObject({ shares: 60, averageCost: 100, realizedProfit: 400, totalSellAmount: 4400 });
    expect(store.getCleared()).toHaveLength(0);
    await store.sell('600519', '贵州茅台', 90, 60, '全部卖出');
    expect(store.getPosition('600519')).toBeUndefined();
    expect(store.getCleared()[0]).toMatchObject({ totalBuyAmount: 10000, totalSellAmount: 9800, realizedProfit: -200, returnPercent: -2, tradeCount: 3 });
    expect(store.getCleared()[0].trades.map((trade) => trade.side)).toEqual(['buy', 'sell', 'sell']);
    expect(writes.at(-1)).toEqual(['600519', undefined, undefined]);
  });

  it('keeps the remaining cost basis when buying again after a partial sell', async () => {
    const { store } = harness();
    await store.sell('600519', '贵州茅台', 110, 50);
    const position = await store.buy('600519', '贵州茅台', 120, 50);
    expect(position).toMatchObject({ shares: 100, totalBuyAmount: 16000, totalSellAmount: 5500, realizedProfit: 500 });
    expect(position.averageCost).toBe(110);
  });

  it('starts a new position cycle after a clear and rejects overselling', async () => {
    const { store } = harness();
    await expect(store.sell('600519', '贵州茅台', 90, 101)).rejects.toThrow('不能超过');
    await store.sell('600519', '贵州茅台', 110, 100);
    await store.buy('600519', '贵州茅台', 80, 100);
    expect(store.getPosition('600519')).toMatchObject({ shares: 100, averageCost: 80 });
    expect(store.getCleared()).toHaveLength(1);
    expect(new Set(store.getTrades().map((trade) => trade.positionId)).size).toBe(2);
  });

  it('allows legacy manual edits but protects real transaction history', async () => {
    const { store } = harness();
    await store.setManualPosition('600519', '贵州茅台', 88, 200);
    expect(store.getPosition('600519')).toMatchObject({ averageCost: 88, shares: 200 });
    expect(store.getTrades()).toHaveLength(1);
    expect(store.getTrades()[0]).toMatchObject({ price: 88, shares: 200, legacy: true });
    await store.buy('600519', '贵州茅台', 90, 100);
    await expect(store.setManualPosition('600519', '贵州茅台', 80, 300)).rejects.toThrow('真实交易流水');
    await expect(store.setManualPosition('600519', '贵州茅台', undefined, undefined)).rejects.toThrow('真实交易流水');
  });

  it('removes the associated transaction history when deleting a cleared record', async () => {
    const { store } = harness();
    await store.sell('600519', '贵州茅台', 110, 100);
    const cleared = store.getCleared()[0];
    expect(store.getTrades(cleared.positionId)).toHaveLength(2);
    await store.deleteCleared(cleared.id);
    expect(store.getCleared()).toHaveLength(0);
    expect(store.getTrades(cleared.positionId)).toHaveLength(0);
  });

  it('clears a legacy manual position and its synthetic trade together', async () => {
    const { store } = harness();
    await store.setManualPosition('600519', '贵州茅台', 88, 200);
    await store.setManualPosition('600519', '贵州茅台', undefined, undefined);
    expect(store.getPosition('600519')).toBeUndefined();
    expect(store.getTrades()).toHaveLength(0);
  });
});
