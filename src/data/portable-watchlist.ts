import type { AlertRule, WatchlistEntry, WatchlistGroup } from '../domain/types';
import { createStockRef } from '../market/stock-code';
import type { WatchlistData } from '../state/watchlist-store';

export const PORTABLE_FORMAT = 'a-stock-watch-backup';
export const PORTABLE_VERSION = 1;

export interface PortableWatchlistBackup {
  format: typeof PORTABLE_FORMAT;
  version: typeof PORTABLE_VERSION;
  exportedAt: string;
  pluginVersion: string;
  data: WatchlistData & { currentCode?: string; alerts?: AlertRule[] };
}

export interface ImportResult {
  watchlist: WatchlistData;
  currentCode?: string;
  alerts?: AlertRule[];
}

export function createPortableBackup(watchlist: WatchlistData, currentCode: string | undefined, pluginVersion: string, now = new Date(), alerts?: readonly AlertRule[]): PortableWatchlistBackup {
  return {
    format: PORTABLE_FORMAT,
    version: PORTABLE_VERSION,
    exportedAt: now.toISOString(),
    pluginVersion,
    data: {
      groups: watchlist.groups.map((group) => ({ ...group })),
      entries: watchlist.entries.map((entry) => ({ ...entry })),
      ...(currentCode ? { currentCode } : {}),
      ...(alerts ? { alerts: alerts.map((rule) => ({ ...rule })) } : {})
    }
  };
}

export function serializePortableBackup(backup: PortableWatchlistBackup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export function parsePortableBackup(text: string): PortableWatchlistBackup {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('备份文件不是有效的 JSON'); }
  const root = object(raw, '备份文件');
  if (root.format !== PORTABLE_FORMAT) throw new Error('不是 A股盯盘备份文件');
  if (root.version !== PORTABLE_VERSION) throw new Error(`不支持的备份版本：${String(root.version)}`);
  if (typeof root.exportedAt !== 'string' || !Number.isFinite(Date.parse(root.exportedAt))) throw new Error('导出时间无效');
  if (typeof root.pluginVersion !== 'string' || !root.pluginVersion.trim()) throw new Error('插件版本无效');
  const data = object(root.data, '备份数据');
  const groups = parseGroups(data.groups);
  const entries = parseEntries(data.entries, groups);
  const currentCode = data.currentCode;
  if (currentCode !== undefined && (typeof currentCode !== 'string' || !entries.some((entry) => entry.code === currentCode))) {
    throw new Error('当前股票不在备份的自选股中');
  }
  const alerts = data.alerts === undefined ? undefined : parseAlerts(data.alerts);
  return {
    format: PORTABLE_FORMAT,
    version: PORTABLE_VERSION,
    exportedAt: root.exportedAt,
    pluginVersion: root.pluginVersion,
    data: { groups, entries, ...(typeof currentCode === 'string' ? { currentCode } : {}), ...(alerts ? { alerts } : {}) }
  };
}

export function restorePortableBackup(backup: PortableWatchlistBackup): ImportResult {
  return {
    watchlist: {
      groups: backup.data.groups.map((group) => ({ ...group })),
      entries: backup.data.entries.map((entry) => ({ ...entry }))
    },
    currentCode: backup.data.currentCode,
    ...(backup.data.alerts ? { alerts: backup.data.alerts.map((rule) => ({ ...rule })) } : {})
  };
}

export function mergePortableBackup(local: WatchlistData, localCurrentCode: string | undefined, backup: PortableWatchlistBackup, localAlerts: readonly AlertRule[] = []): ImportResult {
  const localGroups = [...local.groups].sort(bySortOrder).map((group) => ({ ...group }));
  const groupIdMap = new Map<string, string>();
  let nextGroupOrder = Math.max(-1, ...localGroups.map((group) => group.sortOrder)) + 1;
  for (const imported of [...backup.data.groups].sort(bySortOrder)) {
    const match = localGroups.find((group) => group.id === imported.id)
      ?? localGroups.find((group) => group.name === imported.name);
    if (match) {
      match.name = imported.name;
      match.collapsed = imported.collapsed;
      groupIdMap.set(imported.id, match.id);
    } else {
      const added = { ...imported, sortOrder: nextGroupOrder++ };
      localGroups.push(added);
      groupIdMap.set(imported.id, added.id);
    }
  }
  const importedCodes = new Set(backup.data.entries.map((entry) => entry.code));
  const importedByGroup = new Map<string, WatchlistEntry[]>();
  for (const entry of [...backup.data.entries].sort(bySortOrder)) {
    const groupId = groupIdMap.get(entry.groupId);
    if (!groupId) throw new Error(`无法匹配导入分组：${entry.groupId}`);
    const rows = importedByGroup.get(groupId) ?? [];
    rows.push({ ...entry, groupId });
    importedByGroup.set(groupId, rows);
  }
  const mergedEntries: WatchlistEntry[] = [];
  for (const group of [...localGroups].sort(bySortOrder)) {
    const imported = importedByGroup.get(group.id) ?? [];
    const localOnly = local.entries
      .filter((entry) => entry.groupId === group.id && !importedCodes.has(entry.code))
      .sort(bySortOrder);
    [...imported, ...localOnly].forEach((entry, sortOrder) => mergedEntries.push({ ...entry, sortOrder }));
  }
  const allCodes = new Set(mergedEntries.map((entry) => entry.code));
  const currentCode = backup.data.currentCode && allCodes.has(backup.data.currentCode)
    ? backup.data.currentCode
    : localCurrentCode && allCodes.has(localCurrentCode) ? localCurrentCode : mergedEntries[0]?.code;
  return {
    watchlist: { groups: localGroups, entries: mergedEntries },
    currentCode,
    ...(backup.data.alerts ? { alerts: mergeAlerts(localAlerts, backup.data.alerts) } : {})
  };
}

function mergeAlerts(local: readonly AlertRule[], remote: readonly AlertRule[]): AlertRule[] {
  const merged = new Map(local.map((rule) => [rule.id, { ...rule }]));
  for (const rule of remote) {
    const existing = merged.get(rule.id);
    if (!existing || Date.parse(rule.updatedAt) >= Date.parse(existing.updatedAt)) merged.set(rule.id, { ...rule });
  }
  return [...merged.values()].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id));
}

function parseAlerts(value: unknown): AlertRule[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('提醒规则数量异常');
  return value.map((item, index) => {
    const row = object(item, `提醒规则 ${index + 1}`) as Partial<AlertRule>;
    if (typeof row.id !== 'string' || !row.id || typeof row.code !== 'string' || !/^\d{6}$/.test(row.code)) throw new Error(`提醒规则 ${index + 1} 无效`);
    if (typeof row.type !== 'string' || typeof row.threshold !== 'number' || !Number.isFinite(row.threshold) || row.threshold <= 0) throw new Error(`提醒规则 ${index + 1} 阈值无效`);
    if (row.severity !== 'preview' && row.severity !== 'normal' && row.severity !== 'important') throw new Error(`提醒规则 ${index + 1} 等级无效`);
    if (typeof row.enabled !== 'boolean' || typeof row.createdAt !== 'string' || typeof row.updatedAt !== 'string') throw new Error(`提醒规则 ${index + 1} 状态无效`);
    return { ...row } as AlertRule;
  });
}

function parseGroups(value: unknown): WatchlistGroup[] {
  if (!Array.isArray(value) || !value.length || value.length > 500) throw new Error('分组数据为空或数量异常');
  const ids = new Set<string>();
  const groups = value.map((item, index) => {
    const row = object(item, `分组 ${index + 1}`);
    if (typeof row.id !== 'string' || !row.id.trim() || row.id.length > 100 || ids.has(row.id)) throw new Error(`分组 ${index + 1} 的 ID 无效或重复`);
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 100) throw new Error(`分组 ${index + 1} 的名称无效`);
    if (!Number.isSafeInteger(row.sortOrder)) throw new Error(`分组 ${index + 1} 的顺序无效`);
    const sortOrder = row.sortOrder as number;
    if (typeof row.collapsed !== 'boolean') throw new Error(`分组 ${index + 1} 的折叠状态无效`);
    ids.add(row.id);
    return { id: row.id, name: row.name, sortOrder, collapsed: row.collapsed };
  });
  if (!ids.has('default')) throw new Error('备份缺少默认分组');
  return groups;
}

function parseEntries(value: unknown, groups: WatchlistGroup[]): WatchlistEntry[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('自选股数据数量异常');
  const groupIds = new Set(groups.map((group) => group.id));
  const codes = new Set<string>();
  return value.map((item, index) => {
    const row = object(item, `股票 ${index + 1}`);
    if (typeof row.code !== 'string' || codes.has(row.code)) throw new Error(`股票 ${index + 1} 的代码无效或重复`);
    let canonical;
    try { canonical = createStockRef(row.code); } catch { throw new Error(`股票代码不受支持：${row.code}`); }
    if (row.market !== canonical.market || row.secid !== canonical.secid) throw new Error(`股票 ${row.code} 的市场标识不一致`);
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 100) throw new Error(`股票 ${row.code} 的名称无效`);
    if (typeof row.groupId !== 'string' || !groupIds.has(row.groupId)) throw new Error(`股票 ${row.code} 引用了不存在的分组`);
    if (!Number.isSafeInteger(row.sortOrder)) throw new Error(`股票 ${row.code} 的顺序无效`);
    const sortOrder = row.sortOrder as number;
    const costPrice = optionalNonNegative(row.costPrice, `股票 ${row.code} 的成本价`);
    const shares = optionalNonNegative(row.shares, `股票 ${row.code} 的股数`);
    codes.add(row.code);
    const followed = row.followed === undefined ? row.groupId === 'default' : row.followed;
    if (typeof followed !== 'boolean') throw new Error(`股票 ${row.code} 的关注状态无效`);
    return { ...canonical, name: row.name, groupId: row.groupId, sortOrder, followed, ...(costPrice !== undefined ? { costPrice } : {}), ...(shares !== undefined ? { shares } : {}) };
  });
}

function optionalNonNegative(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label}无效`);
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}结构无效`);
  return value as Record<string, unknown>;
}

function bySortOrder(left: { sortOrder: number }, right: { sortOrder: number }): number {
  return left.sortOrder - right.sortOrder;
}
