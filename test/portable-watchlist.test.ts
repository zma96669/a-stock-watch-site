import { describe, expect, it } from 'vitest';
import {
  createPortableBackup,
  mergePortableBackup,
  parsePortableBackup,
  restorePortableBackup,
  serializePortableBackup
} from '../src/data/portable-watchlist';
import type { WatchlistData } from '../src/state/watchlist-store';

const local: WatchlistData = {
  groups: [
    { id: 'default', name: '默认分组', sortOrder: 0, collapsed: false },
    { id: 'bank', name: '银行', sortOrder: 1, collapsed: true }
  ],
  entries: [
    { code: '600519', secid: '1.600519', market: 'SH', name: '贵州茅台', groupId: 'default', sortOrder: 0 },
    { code: '002142', secid: '0.002142', market: 'SZ', name: '宁波银行', groupId: 'bank', sortOrder: 0, costPrice: 20.5, shares: 1000 }
  ]
};

describe('portable watchlist backup', () => {
  it('round trips groups, order, holdings and current stock without loss', () => {
    const created = createPortableBackup(local, '002142', '0.1.28', new Date('2026-08-23T10:00:00.000Z'));
    const parsed = parsePortableBackup(serializePortableBackup(created));
    expect(restorePortableBackup(parsed)).toEqual({ watchlist: local, currentCode: '002142' });
    expect(parsed).toMatchObject({ format: 'a-stock-watch-backup', version: 1, pluginVersion: '0.1.28' });
  });

  it('rejects malformed, duplicate and inconsistent stock data', () => {
    expect(() => parsePortableBackup('{')).toThrow('有效的 JSON');
    const backup = createPortableBackup(local, '002142', '0.1.28');
    const duplicate = structuredClone(backup);
    duplicate.data.entries.push({ ...duplicate.data.entries[0] });
    expect(() => parsePortableBackup(JSON.stringify(duplicate))).toThrow('无效或重复');
    const wrongMarket = structuredClone(backup);
    wrongMarket.data.entries[0].market = 'SZ';
    expect(() => parsePortableBackup(JSON.stringify(wrongMarket))).toThrow('市场标识不一致');
  });

  it('merges local-only stocks while imported duplicates win', () => {
    const imported: WatchlistData = {
      groups: [
        { id: 'default', name: '默认分组', sortOrder: 0, collapsed: true },
        { id: 'bank', name: '银行', sortOrder: 1, collapsed: false }
      ],
      entries: [
        { code: '600519', secid: '1.600519', market: 'SH', name: '贵州茅台', groupId: 'bank', sortOrder: 0, costPrice: 1500, shares: 10 }
      ]
    };
    const backup = createPortableBackup(imported, '600519', '0.1.28');
    const merged = mergePortableBackup(local, '002142', backup);
    expect(merged.currentCode).toBe('600519');
    expect(merged.watchlist.entries).toHaveLength(2);
    expect(merged.watchlist.entries.find((entry) => entry.code === '600519')).toMatchObject({ groupId: 'bank', costPrice: 1500, shares: 10, sortOrder: 0 });
    expect(merged.watchlist.entries.find((entry) => entry.code === '002142')).toMatchObject({ groupId: 'bank', costPrice: 20.5, shares: 1000, sortOrder: 1 });
  });
});
