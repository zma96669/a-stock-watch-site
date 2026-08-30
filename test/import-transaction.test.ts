import { describe, expect, it, vi } from 'vitest';
import { applyImportTransaction } from '../src/data/import-transaction';
import type { ImportResult } from '../src/data/portable-watchlist';

const state = (code: string): ImportResult => ({
  watchlist: {
    groups: [{ id: 'default', name: '默认分组', sortOrder: 0, collapsed: false }],
    entries: [{ code, secid: `0.${code}`, market: 'SZ', name: code, groupId: 'default', sortOrder: 0 }]
  },
  currentCode: code
});

describe('applyImportTransaction', () => {
  it('applies watchlist before current stock', async () => {
    const calls: string[] = [];
    await applyImportTransaction(state('000002'), state('000001'), {
      replaceWatchlist: async (data) => { calls.push(`watchlist:${data.entries[0].code}`); },
      setCurrentCode: async (code) => { calls.push(`current:${code}`); }
    });
    expect(calls).toEqual(['watchlist:000002', 'current:000002']);
  });

  it('rolls both values back when applying the current stock fails', async () => {
    const calls: string[] = [];
    const setCurrentCode = vi.fn(async (code: string | undefined) => {
      calls.push(`current:${code}`);
      if (code === '000002') throw new Error('write failed');
    });
    await expect(applyImportTransaction(state('000002'), state('000001'), {
      replaceWatchlist: async (data) => { calls.push(`watchlist:${data.entries[0].code}`); },
      setCurrentCode
    })).rejects.toThrow('已恢复原数据');
    expect(calls).toEqual(['watchlist:000002', 'current:000002', 'watchlist:000001', 'current:000001']);
  });

  it('writes and rolls back portfolio together with watchlist data', async () => {
    const calls: string[] = [];
    const before = { ...state('000001'), portfolio: { positions: [], trades: [], cleared: [] } };
    const next = { ...state('000002'), portfolio: { positions: [], trades: [], cleared: [] } };
    let portfolioCalls = 0;
    await expect(applyImportTransaction(next, before, {
      replaceWatchlist: async () => { calls.push('watchlist'); },
      setCurrentCode: async () => { calls.push('current'); },
      replacePortfolio: async () => { calls.push('portfolio'); if (++portfolioCalls === 1) throw new Error('portfolio failed'); }
    })).rejects.toThrow('已恢复原数据');
    expect(calls).toEqual(['watchlist', 'current', 'portfolio', 'watchlist', 'current', 'portfolio']);
  });
});
