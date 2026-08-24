import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  }
}));

import { AlertStore } from '../src/state/alert-store';

function harness(now = new Date('2026-08-24T02:00:00.000Z')) {
  const values = new Map<string, unknown>();
  const memento = {
    get: (key: string) => values.get(key),
    update: vi.fn(async (key: string, value: unknown) => { values.set(key, structuredClone(value)); })
  };
  let current = now;
  const store = new AlertStore(memento as never, () => current);
  return { store, values, setNow: (value: Date) => { current = value; } };
}

describe('AlertStore', () => {
  it('persists validated alert rules and defaults price rules to important with proximity', async () => {
    const { store, values } = harness();
    const rule = await store.create({ code: '600519', type: 'price-above', threshold: 1500 });
    expect(rule).toMatchObject({ code: '600519', threshold: 1500, severity: 'important', proximityPercent: 0.5, enabled: true });
    expect(values.get('aStockWatch.alerts.rules')).toEqual([rule]);
    await store.toggle(rule.id);
    expect(store.getRule(rule.id)?.enabled).toBe(false);
  });

  it('keeps events local and clears daily runtime on the next China trading date', async () => {
    const { store, setNow } = harness();
    const rule = await store.create({ code: '000001', type: 'volume-ratio', threshold: 2 });
    await store.record({ id: 'event', ruleId: rule.id, code: '000001', stockName: '平安银行', type: rule.type, severity: 'normal', title: '量比提醒', message: '2.1倍', value: 2.1, threshold: 2, triggeredAt: '2026-08-24T02:00:00.000Z', read: false });
    await store.muteToday(rule.id);
    expect(store.unreadCount()).toBe(1);
    expect(store.isMutedToday(rule.id)).toBe(true);
    setNow(new Date('2026-08-25T02:00:00.000Z'));
    expect(store.getEvents()).toEqual([]);
    expect(store.isMutedToday(rule.id)).toBe(false);
    expect(store.getRules()).toHaveLength(1);
  });
});
