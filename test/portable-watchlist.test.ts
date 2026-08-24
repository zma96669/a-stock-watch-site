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
    { id: 'default', name: '我的关注', sortOrder: 0, collapsed: false },
    { id: 'bank', name: '银行', sortOrder: 1, collapsed: true }
  ],
  entries: [
    { code: '600519', secid: '1.600519', market: 'SH', name: '贵州茅台', groupId: 'default', sortOrder: 0, followed: true },
    { code: '002142', secid: '0.002142', market: 'SZ', name: '宁波银行', groupId: 'bank', sortOrder: 0, followed: false, costPrice: 20.5, shares: 1000 }
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
        { id: 'default', name: '我的关注', sortOrder: 0, collapsed: true },
        { id: 'bank', name: '银行', sortOrder: 1, collapsed: false }
      ],
      entries: [
        { code: '600519', secid: '1.600519', market: 'SH', name: '贵州茅台', groupId: 'bank', sortOrder: 0, followed: false, costPrice: 1500, shares: 10 }
      ]
    };
    const backup = createPortableBackup(imported, '600519', '0.1.28');
    const merged = mergePortableBackup(local, '002142', backup);
    expect(merged.currentCode).toBe('600519');
    expect(merged.watchlist.entries).toHaveLength(2);
    expect(merged.watchlist.entries.find((entry) => entry.code === '600519')).toMatchObject({ groupId: 'bank', followed: false, costPrice: 1500, shares: 10, sortOrder: 0 });
    expect(merged.watchlist.entries.find((entry) => entry.code === '002142')).toMatchObject({ groupId: 'bank', costPrice: 20.5, shares: 1000, sortOrder: 1 });
  });

  it('accepts old backups without followed fields and derives their state', () => {
    const legacy = createPortableBackup(local, '002142', '0.1.28');
    legacy.data.groups[0].name = '默认分组';
    legacy.data.entries.forEach((item) => { delete item.followed; });
    const parsed = parsePortableBackup(JSON.stringify(legacy));
    expect(parsed.data.entries.find((item) => item.code === '600519')?.followed).toBe(true);
    expect(parsed.data.entries.find((item) => item.code === '002142')?.followed).toBe(false);
  });

  it('round trips alert rules while remaining compatible with backups without alerts', () => {
    const rule = {
      id: 'rule-1', code: '600519', type: 'price-above' as const, threshold: 1500, proximityPercent: .5,
      severity: 'important' as const, enabled: true, createdAt: '2026-08-23T10:00:00.000Z', updatedAt: '2026-08-23T10:00:00.000Z'
    };
    const backup = createPortableBackup(local, '600519', '0.1.34', new Date('2026-08-23T10:00:00.000Z'), [rule]);
    const parsed = parsePortableBackup(serializePortableBackup(backup));
    expect(restorePortableBackup(parsed).alerts).toEqual([rule]);
    expect(restorePortableBackup(parsePortableBackup(serializePortableBackup(createPortableBackup(local, '600519', '0.1.33')))).alerts).toBeUndefined();
  });
});
