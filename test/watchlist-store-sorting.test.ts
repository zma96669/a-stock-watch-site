import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  }
}));

import { WatchlistStore } from '../src/state/watchlist-store';
import type { WatchlistEntry, WatchlistGroup } from '../src/domain/types';

const stock = (code: string, groupId: string, sortOrder: number, holding = false): WatchlistEntry => ({
  code,
  secid: `0.${code}`,
  market: 'SZ',
  name: code,
  groupId,
  sortOrder,
  ...(holding ? { costPrice: 10, shares: 100 } : {})
});

const group = (id: string, sortOrder: number): WatchlistGroup => ({ id, name: id, sortOrder, collapsed: false });

function createStore(groups: WatchlistGroup[], entries: WatchlistEntry[]) {
  let saved: unknown = { groups, entries };
  const state = {
    get: () => saved,
    update: async (_key: string, value: unknown) => { saved = value; }
  };
  return { store: new WatchlistStore(state as never), saved: () => saved };
}

describe('WatchlistStore drag sorting', () => {
  it('reorders groups and persists normalized sort orders', async () => {
    const { store, saved } = createStore([group('default', 0), group('g1', 1), group('g2', 2)], []);
    await store.reorderGroup('g2', 'default', 'before');
    expect(store.getGroups().map((item) => item.id)).toEqual(['g2', 'default', 'g1']);
    expect((saved() as { groups: WatchlistGroup[] }).groups.map((item) => item.sortOrder).sort()).toEqual([0, 1, 2]);
  });

  it('reorders stocks inside a group', async () => {
    const { store } = createStore([group('default', 0)], [stock('000001', 'default', 0), stock('000002', 'default', 1), stock('000003', 'default', 2)]);
    await store.placeStock('000003', 'default', '000001', 'before');
    expect(store.getEntries().map((item) => item.code)).toEqual(['000003', '000001', '000002']);
  });

  it('moves a stock across groups at the requested position', async () => {
    const { store } = createStore([group('default', 0), group('g2', 1)], [stock('000001', 'default', 0), stock('000002', 'default', 1), stock('000003', 'g2', 0)]);
    await store.placeStock('000001', 'g2', '000003', 'before');
    expect(store.getEntries().filter((item) => item.groupId === 'g2').map((item) => item.code)).toEqual(['000001', '000003']);
  });

  it('does not drag holdings out of the fixed holdings area', async () => {
    const holding = stock('000001', 'default', 0, true);
    const { store, saved } = createStore([group('default', 0), group('g2', 1)], [holding]);
    await store.placeStock(holding.code, 'g2');
    expect(store.getEntry(holding.code)?.groupId).toBe('default');
    expect((saved() as { entries: WatchlistEntry[] }).entries[0].groupId).toBe('default');
  });
});
