import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  }
}));

import type { WatchlistEntry, WatchlistGroup } from '../src/domain/types';
import { WatchlistStore } from '../src/state/watchlist-store';

const groups: WatchlistGroup[] = [
  { id: 'default', name: '默认分组', sortOrder: 0, collapsed: false },
  { id: 'bank', name: '银行', sortOrder: 1, collapsed: false }
];

const entry = (code: string, groupId: string, followed?: boolean): WatchlistEntry => ({
  code,
  secid: `0.${code}`,
  market: 'SZ',
  name: code,
  groupId,
  sortOrder: 0,
  ...(followed === undefined ? {} : { followed })
});

function createStore(entries: WatchlistEntry[]) {
  let saved: unknown = { groups, entries };
  const state = {
    get: () => saved,
    update: async (_key: string, value: unknown) => { saved = value; }
  };
  return { store: new WatchlistStore(state as never), saved: () => saved };
}

describe('WatchlistStore followed stocks', () => {
  it('migrates the old default group to 我的关注 without losing its stocks', () => {
    const { store } = createStore([entry('000001', 'default'), entry('000002', 'bank')]);
    expect(store.getGroups().find((group) => group.id === 'default')?.name).toBe('我的关注');
    expect(store.getEntry('000001')?.followed).toBe(true);
    expect(store.getEntry('000002')?.followed).toBe(false);
  });

  it('follows a stock without moving it out of its original group', async () => {
    const { store, saved } = createStore([entry('000001', 'bank', false)]);
    await store.setFollowed('000001', true);
    expect(store.getEntry('000001')).toMatchObject({ groupId: 'bank', followed: true });
    expect((saved() as { entries: WatchlistEntry[] }).entries[0]).toMatchObject({ groupId: 'bank', followed: true });
  });

  it('requires a default-only stock to move before it can be unfollowed', async () => {
    const { store } = createStore([entry('000001', 'default', true)]);
    await expect(store.setFollowed('000001', false)).rejects.toThrow('先把这只股票移动到普通分组');
    await store.move('000001', 'bank');
    await store.setFollowed('000001', false);
    expect(store.getEntry('000001')).toMatchObject({ groupId: 'bank', followed: false });
  });

  it('adds stocks in 我的关注 as followed and rejects blank group names', async () => {
    const { store } = createStore([]);
    await store.add({ code: '000001', secid: '0.000001', market: 'SZ', name: '平安银行' }, 'default');
    expect(store.getEntry('000001')?.followed).toBe(true);
    await expect(store.addGroup('   ')).rejects.toThrow('分组名称不能为空');
  });
});
