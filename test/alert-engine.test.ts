import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  }
}));

import type { MarketSnapshot, StockQuote, WatchlistEntry } from '../src/domain/types';
import { AlertEngine, isChinaTradingTime } from '../src/services/alert-engine';
import { AlertStore } from '../src/state/alert-store';

const entry: WatchlistEntry = { code: '600519', secid: '1.600519', market: 'SH', name: '贵州茅台', groupId: 'default', sortOrder: 0, costPrice: 100, shares: 100 };

function quote(price: number, options: Partial<StockQuote> = {}): StockQuote {
  return { ...entry, price, previousClose: 100, change: price - 100, changePercent: price - 100, volume: 100, amount: 1_000_000, turnoverRate: 1, volumeRatio: 1, suspended: false, ...options };
}

function snapshot(at: Date, stock = quote(100)): MarketSnapshot {
  return { quotes: { '600519': stock }, indexQuotes: {}, indexIntraday: {}, intraday: [], stale: false, quoteUpdatedAt: at.toISOString() };
}

function harness(initial = new Date('2026-08-24T02:00:00.000Z')) {
  const values = new Map<string, unknown>();
  const state = { get: (key: string) => values.get(key), update: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); } };
  let now = initial;
  const alerts = new AlertStore(state as never, () => now);
  const engine = new AlertEngine(alerts, () => [entry], () => now);
  return { alerts, engine, now: () => now, setNow: (value: Date) => { now = value; } };
}

describe('AlertEngine', () => {
  it('triggers only on crossing, resets after recovery and respects ten-minute cooldown', async () => {
    const { alerts, engine, now, setNow } = harness();
    await alerts.create({ code: entry.code, type: 'price-above', threshold: 101, proximityPercent: 0 });
    expect(await engine.evaluate(snapshot(now(), quote(100)))).toHaveLength(0);
    setNow(new Date('2026-08-24T02:00:05.000Z'));
    expect(await engine.evaluate(snapshot(now(), quote(102)))).toHaveLength(1);
    setNow(new Date('2026-08-24T02:00:10.000Z'));
    expect(await engine.evaluate(snapshot(now(), quote(103)))).toHaveLength(0);
    setNow(new Date('2026-08-24T02:01:00.000Z'));
    expect(await engine.evaluate(snapshot(now(), quote(100)))).toHaveLength(0);
    setNow(new Date('2026-08-24T02:05:00.000Z'));
    expect(await engine.evaluate(snapshot(now(), quote(102)))).toHaveLength(0);
    setNow(new Date('2026-08-24T02:11:00.000Z'));
    await engine.evaluate(snapshot(now(), quote(100)));
    setNow(new Date('2026-08-24T02:11:05.000Z'));
    expect(await engine.evaluate(snapshot(now(), quote(102)))).toHaveLength(1);
  });

  it('detects three-minute rapid movement from lightweight quote history', async () => {
    const { alerts, engine, now, setNow } = harness();
    await alerts.create({ code: entry.code, type: 'rapid-rise', threshold: 1, windowMinutes: 3 });
    await engine.evaluate(snapshot(now(), quote(100)));
    setNow(new Date('2026-08-24T02:03:05.000Z'));
    const events = await engine.evaluate(snapshot(now(), quote(101.2)));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'rapid-rise', severity: 'normal', stockName: '贵州茅台' });
  });

  it('does not evaluate outside A-share trading sessions or with stale quotes', async () => {
    const { alerts, engine, setNow } = harness();
    await alerts.create({ code: entry.code, type: 'price-above', threshold: 101 });
    setNow(new Date('2026-08-24T04:00:00.000Z'));
    expect(isChinaTradingTime(new Date('2026-08-24T04:00:00.000Z'))).toBe(false);
    expect(await engine.evaluate(snapshot(new Date('2026-08-24T04:00:00.000Z'), quote(102)))).toEqual([]);
    setNow(new Date('2026-08-24T02:00:00.000Z'));
    expect(await engine.evaluate(snapshot(new Date('2026-08-24T01:55:00.000Z'), quote(102)))).toEqual([]);
  });
});
