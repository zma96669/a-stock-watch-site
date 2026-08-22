import * as vscode from 'vscode';
import type { StockRef, WatchlistEntry, WatchlistGroup } from '../domain/types';

const KEY = 'aStockWatch.watchlist';
const DEFAULT_GROUP_ID = 'default';

interface PersistedWatchlist {
  groups: WatchlistGroup[];
  entries: WatchlistEntry[];
}

export class WatchlistStore {
  private entries: WatchlistEntry[];
  private groups: WatchlistGroup[];
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly state: vscode.Memento) {
    const saved = state.get<unknown>(KEY);
    if (Array.isArray(saved)) {
      this.groups = [{ id: DEFAULT_GROUP_ID, name: '默认分组', sortOrder: 0, collapsed: false }];
      this.entries = saved.filter(isStockRef).map((stock, index) => ({ ...stock, groupId: DEFAULT_GROUP_ID, sortOrder: index }));
    } else {
      const value = saved as Partial<PersistedWatchlist> | undefined;
      this.groups = Array.isArray(value?.groups) && value.groups.length
        ? value.groups.filter(isGroup)
        : [{ id: DEFAULT_GROUP_ID, name: '默认分组', sortOrder: 0, collapsed: false }];
      this.entries = Array.isArray(value?.entries) ? value.entries.filter(isEntry) : [];
      if (!this.groups.some((group) => group.id === DEFAULT_GROUP_ID)) {
        this.groups.unshift({ id: DEFAULT_GROUP_ID, name: '默认分组', sortOrder: -1, collapsed: false });
      }
    }
  }

  getAll(): readonly StockRef[] {
    return this.getEntries().map(({ groupId: _groupId, sortOrder: _sortOrder, costPrice: _costPrice, shares: _shares, ...stock }) => stock);
  }

  get(code: string): StockRef | undefined {
    return this.entries.find((stock) => stock.code === code);
  }

  getEntry(code: string): WatchlistEntry | undefined {
    return this.entries.find((stock) => stock.code === code);
  }

  getEntries(): readonly WatchlistEntry[] {
    return [...this.entries].sort((left, right) => {
      const groupOrder = this.groupRank(left.groupId) - this.groupRank(right.groupId);
      if (groupOrder) return groupOrder;
      const leftHolding = isHolding(left) ? 0 : 1;
      const rightHolding = isHolding(right) ? 0 : 1;
      return leftHolding - rightHolding || left.sortOrder - right.sortOrder || left.code.localeCompare(right.code);
    });
  }

  getGroups(): readonly WatchlistGroup[] {
    return [...this.groups].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  }

  private groupRank(id: string): number {
    return this.groups.find((group) => group.id === id)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  }

  async add(stock: StockRef, groupId = DEFAULT_GROUP_ID): Promise<void> {
    if (this.get(stock.code)) return;
    const group = this.groups.some((item) => item.id === groupId) ? groupId : DEFAULT_GROUP_ID;
    const maxSort = Math.max(-1, ...this.entries.filter((entry) => entry.groupId === group).map((entry) => entry.sortOrder));
    this.entries = [...this.entries, { ...stock, groupId: group, sortOrder: maxSort + 1 }];
    await this.persist();
  }

  async remove(code: string): Promise<void> {
    this.entries = this.entries.filter((stock) => stock.code !== code);
    await this.persist();
  }

  async updateHolding(code: string, costPrice: number | undefined, shares: number | undefined): Promise<void> {
    const entry = this.getEntry(code);
    if (!entry) return;
    this.entries = this.entries.map((item) => item.code === code ? { ...item, costPrice, shares } : item);
    await this.persist();
  }

  async move(code: string, groupId: string): Promise<void> {
    const entry = this.getEntry(code);
    if (!entry || !this.groups.some((group) => group.id === groupId) || entry.groupId === groupId) return;
    const maxSort = Math.max(-1, ...this.entries.filter((item) => item.groupId === groupId).map((item) => item.sortOrder));
    this.entries = this.entries.map((item) => item.code === code ? { ...item, groupId, sortOrder: maxSort + 1 } : item);
    await this.persist();
  }

  async addGroup(name: string): Promise<WatchlistGroup> {
    const id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const group: WatchlistGroup = { id, name: name.trim() || '新分组', sortOrder: Math.max(-1, ...this.groups.map((item) => item.sortOrder)) + 1, collapsed: false };
    this.groups = [...this.groups, group];
    await this.persist();
    return group;
  }

  async renameGroup(id: string, name: string): Promise<void> {
    if (!this.groups.some((group) => group.id === id)) return;
    this.groups = this.groups.map((group) => group.id === id ? { ...group, name: name.trim() || group.name } : group);
    await this.persist();
  }

  async toggleGroup(id: string): Promise<void> {
    this.groups = this.groups.map((group) => group.id === id ? { ...group, collapsed: !group.collapsed } : group);
    await this.persist();
  }

  private async persist(): Promise<void> {
    const value: PersistedWatchlist = { groups: this.groups, entries: this.entries };
    await this.state.update(KEY, value);
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

function isStockRef(value: unknown): value is StockRef {
  const stock = value as Partial<StockRef> | undefined;
  return Boolean(stock && typeof stock.code === 'string' && typeof stock.secid === 'string' && (stock.market === 'SH' || stock.market === 'SZ'));
}

function isEntry(value: unknown): value is WatchlistEntry {
  const entry = value as Partial<WatchlistEntry> | undefined;
  return isStockRef(value) && typeof entry?.groupId === 'string' && Number.isFinite(entry.sortOrder);
}

function isGroup(value: unknown): value is WatchlistGroup {
  const group = value as Partial<WatchlistGroup> | undefined;
  return Boolean(group && typeof group.id === 'string' && typeof group.name === 'string' && Number.isFinite(group.sortOrder));
}

function isHolding(entry: WatchlistEntry): boolean {
  return Number.isFinite(entry.costPrice) && Number(entry.costPrice) > 0 && Number.isFinite(entry.shares) && Number(entry.shares) > 0;
}
