import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { ClearedPosition, PortfolioData, PortfolioPosition, TradeRecord, WatchlistEntry } from '../domain/types';

const KEY = 'aStockWatch.portfolio';
const MAX_TRADES = 10000;
const MAX_CLEARED = 1000;

export class PortfolioStore implements vscode.Disposable {
  private data: PortfolioData;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly state: vscode.Memento,
    private readonly entries: () => readonly WatchlistEntry[],
    private readonly syncLegacyHolding: (code: string, costPrice: number | undefined, shares: number | undefined) => Promise<void>,
    private readonly now: () => Date = () => new Date()
  ) {
    const saved = state.get<unknown>(KEY);
    this.data = saved === undefined ? migrateLegacyPortfolio(this.entries(), this.now) : normalizePortfolio(saved);
    if (saved === undefined && (this.data.positions.length || this.data.trades.length)) void this.persist();
  }

  getData(): PortfolioData {
    return cloneData(this.data);
  }

  getPositions(): readonly PortfolioPosition[] {
    return this.data.positions.map((position) => ({ ...position }));
  }

  getPosition(code: string): PortfolioPosition | undefined {
    const position = this.data.positions.find((item) => item.code === code);
    return position ? { ...position } : undefined;
  }

  getCleared(): readonly ClearedPosition[] {
    return this.data.cleared.map((item) => ({ ...item, trades: item.trades.map((trade) => ({ ...trade })) }));
  }

  getTrades(positionId?: string): readonly TradeRecord[] {
    return this.data.trades.filter((trade) => !positionId || trade.positionId === positionId).map((trade) => ({ ...trade }));
  }

  async buy(code: string, stockName: string, price: number, shares: number, note?: string): Promise<PortfolioPosition> {
    validateTrade(code, price, shares);
    let position = this.data.positions.find((item) => item.code === code);
    const tradedAt = this.now().toISOString();
    if (!position) {
      position = {
        id: randomUUID(), code, stockName, shares: 0, averageCost: 0, totalBuyAmount: 0,
        totalSellAmount: 0, realizedProfit: 0, openedAt: tradedAt, updatedAt: tradedAt
      };
    }
    const trade = tradeRecord(position, code, stockName, 'buy', price, shares, tradedAt, note);
    const nextShares = position.shares + shares;
    const nextBuyAmount = position.totalBuyAmount + price * shares;
    const nextAverageCost = (position.averageCost * position.shares + price * shares) / nextShares;
    const next: PortfolioPosition = {
      ...position,
      stockName,
      shares: nextShares,
      averageCost: nextAverageCost,
      totalBuyAmount: nextBuyAmount,
      updatedAt: tradedAt
    };
    this.data = {
      ...this.data,
      positions: [...this.data.positions.filter((item) => item.id !== position!.id), next],
      trades: [...this.data.trades, trade].slice(-MAX_TRADES)
    };
    await this.persist();
    await this.syncLegacyHolding(code, next.averageCost, next.shares);
    return { ...next };
  }

  async sell(code: string, stockName: string, price: number, shares: number, note?: string): Promise<PortfolioPosition | undefined> {
    validateTrade(code, price, shares);
    let position = this.data.positions.find((item) => item.code === code);
    if (!position) {
      position = this.createLegacyPosition(code, stockName);
    }
    if (!position) throw new Error('这只股票当前没有持仓');
    if (shares > position.shares) throw new Error(`卖出股数不能超过当前持仓（${position.shares} 股）`);
    const tradedAt = this.now().toISOString();
    const trade = tradeRecord(position, code, stockName, 'sell', price, shares, tradedAt, note);
    const realizedProfit = position.realizedProfit + (price - position.averageCost) * shares;
    const totalSellAmount = position.totalSellAmount + price * shares;
    const nextShares = position.shares - shares;
    const nextTrades = [...this.data.trades, trade].slice(-MAX_TRADES);
    if (nextShares > 0) {
      const next: PortfolioPosition = { ...position, stockName, shares: nextShares, totalSellAmount, realizedProfit, updatedAt: tradedAt };
      this.data = { ...this.data, positions: this.data.positions.map((item) => item.id === position!.id ? next : item), trades: nextTrades };
      await this.persist();
      await this.syncLegacyHolding(code, next.averageCost, next.shares);
      return { ...next };
    }
    const positionTrades = nextTrades.filter((item) => item.positionId === position!.id);
    const closed: ClearedPosition = {
      id: randomUUID(), positionId: position.id, code, stockName,
      totalBuyAmount: position.totalBuyAmount, totalSellAmount, realizedProfit,
      returnPercent: position.totalBuyAmount > 0 ? realizedProfit / position.totalBuyAmount * 100 : 0,
      tradeCount: positionTrades.length, openedAt: position.openedAt, closedAt: tradedAt,
      ...(note?.trim() ? { note: note.trim() } : {}),
      trades: positionTrades.map((item) => ({ ...item }))
    };
    this.data = {
      positions: this.data.positions.filter((item) => item.id !== position!.id),
      trades: nextTrades,
      cleared: [closed, ...this.data.cleared].slice(0, MAX_CLEARED)
    };
    await this.persist();
    await this.syncLegacyHolding(code, undefined, undefined);
    return undefined;
  }

  async setManualPosition(code: string, stockName: string, costPrice: number | undefined, shares: number | undefined): Promise<void> {
    const existing = this.data.positions.find((item) => item.code === code);
    const existingTrades = existing ? this.data.trades.filter((trade) => trade.positionId === existing.id) : [];
    if (existingTrades.some((trade) => !trade.legacy)) {
      throw new Error('这只股票已有真实交易流水，请使用“买入”或“卖出”调整持仓');
    }
    if (costPrice === undefined || shares === undefined || shares <= 0) {
      this.data = {
        ...this.data,
        positions: this.data.positions.filter((item) => item.code !== code),
        trades: existing ? this.data.trades.filter((trade) => trade.positionId !== existing.id) : this.data.trades
      };
      await this.persist();
      await this.syncLegacyHolding(code, undefined, undefined);
      return;
    }
    if (!Number.isFinite(costPrice) || costPrice <= 0 || !Number.isInteger(shares)) throw new Error('成本价必须大于 0，股数必须为整数');
    const timestamp = this.now().toISOString();
    const position: PortfolioPosition = existing
      ? { ...existing, stockName, shares, averageCost: costPrice, totalBuyAmount: costPrice * shares, updatedAt: timestamp }
      : { id: randomUUID(), code, stockName, shares, averageCost: costPrice, totalBuyAmount: costPrice * shares, totalSellAmount: 0, realizedProfit: 0, openedAt: timestamp, updatedAt: timestamp };
    const synthetic: TradeRecord = {
      id: randomUUID(), positionId: position.id, code, stockName, side: 'buy', price: costPrice, shares, tradedAt: timestamp, legacy: true, note: '手工设置持仓'
    };
    this.data = {
      ...this.data,
      positions: [...this.data.positions.filter((item) => item.id !== position.id), position],
      trades: [...this.data.trades.filter((trade) => trade.positionId !== position.id), synthetic].slice(-MAX_TRADES)
    };
    await this.persist();
    await this.syncLegacyHolding(code, costPrice, shares);
  }

  async deleteCleared(id: string): Promise<void> {
    const cleared = this.data.cleared.find((item) => item.id === id);
    if (!cleared) return;
    this.data = {
      ...this.data,
      trades: this.data.trades.filter((trade) => trade.positionId !== cleared.positionId),
      cleared: this.data.cleared.filter((item) => item.id !== id)
    };
    await this.persist();
  }

  async replace(data: PortfolioData): Promise<void> {
    this.data = normalizePortfolio(data);
    await this.persist();
    for (const position of this.data.positions) await this.syncLegacyHolding(position.code, position.averageCost, position.shares);
  }

  dispose(): void {
    this.emitter.dispose();
  }

  private createLegacyPosition(code: string, stockName: string): PortfolioPosition | undefined {
    const entry = this.entries().find((item) => item.code === code);
    if (!entry || !entry.costPrice || !entry.shares || entry.costPrice <= 0 || entry.shares <= 0) return undefined;
    const timestamp = this.now().toISOString();
    const position: PortfolioPosition = {
      id: randomUUID(), code, stockName: entry.name || stockName, shares: entry.shares, averageCost: entry.costPrice,
      totalBuyAmount: entry.costPrice * entry.shares, totalSellAmount: 0, realizedProfit: 0, openedAt: timestamp, updatedAt: timestamp
    };
    const synthetic = tradeRecord(position, code, position.stockName, 'buy', entry.costPrice, entry.shares, timestamp, '从旧版持仓迁移');
    this.data = { ...this.data, positions: [...this.data.positions, position], trades: [...this.data.trades, synthetic].slice(-MAX_TRADES) };
    return position;
  }

  private async persist(): Promise<void> {
    await this.state.update(KEY, this.data);
    this.emitter.fire();
  }
}

function tradeRecord(position: PortfolioPosition, code: string, stockName: string, side: 'buy' | 'sell', price: number, shares: number, tradedAt: string, note?: string): TradeRecord {
  return { id: randomUUID(), positionId: position.id, code, stockName, side, price, shares, tradedAt, ...(note?.trim() ? { note: note.trim() } : {}) };
}

export function migrateLegacyPortfolio(entries: readonly WatchlistEntry[], now: () => Date = () => new Date()): PortfolioData {
  const timestamp = now().toISOString();
  const positions: PortfolioPosition[] = [];
  const trades: TradeRecord[] = [];
  entries.filter((entry) => Number(entry.costPrice) > 0 && Number(entry.shares) > 0).forEach((entry) => {
    const positionId = randomUUID();
    const shares = Number(entry.shares);
    const averageCost = Number(entry.costPrice);
    positions.push({ id: positionId, code: entry.code, stockName: entry.name, shares, averageCost, totalBuyAmount: averageCost * shares, totalSellAmount: 0, realizedProfit: 0, openedAt: timestamp, updatedAt: timestamp });
    trades.push({ id: randomUUID(), positionId, code: entry.code, stockName: entry.name, side: 'buy', price: averageCost, shares, tradedAt: timestamp, legacy: true, note: '从旧版持仓迁移' });
  });
  return { positions, trades, cleared: [] };
}

function normalizePortfolio(value: unknown): PortfolioData {
  const raw = value as Partial<PortfolioData> | undefined;
  if (!raw || !Array.isArray(raw.positions) || !Array.isArray(raw.trades) || !Array.isArray(raw.cleared)) return { positions: [], trades: [], cleared: [] };
  const trades = raw.trades.filter(isTrade).map((trade) => ({ ...trade })).slice(-MAX_TRADES);
  const positions = raw.positions.filter(isPosition).map((position) => ({ ...position }));
  const cleared = raw.cleared.filter(isCleared).map((item) => ({ ...item, trades: item.trades.map((trade) => ({ ...trade })) })).slice(0, MAX_CLEARED);
  return { positions, trades, cleared };
}

function isTrade(value: unknown): value is TradeRecord {
  const item = value as Partial<TradeRecord> | undefined;
  return Boolean(item && typeof item.id === 'string' && typeof item.positionId === 'string' && /^\d{6}$/.test(item.code ?? '') && typeof item.stockName === 'string' && (item.side === 'buy' || item.side === 'sell') && typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0 && typeof item.shares === 'number' && Number.isInteger(item.shares) && item.shares > 0 && validDate(item.tradedAt));
}

function isPosition(value: unknown): value is PortfolioPosition {
  const item = value as Partial<PortfolioPosition> | undefined;
  return Boolean(item && typeof item.id === 'string' && /^\d{6}$/.test(item.code ?? '') && typeof item.stockName === 'string' && typeof item.shares === 'number' && Number.isInteger(item.shares) && item.shares > 0 && typeof item.averageCost === 'number' && Number.isFinite(item.averageCost) && item.averageCost > 0 && typeof item.totalBuyAmount === 'number' && Number.isFinite(item.totalBuyAmount) && typeof item.totalSellAmount === 'number' && Number.isFinite(item.totalSellAmount) && typeof item.realizedProfit === 'number' && Number.isFinite(item.realizedProfit) && validDate(item.openedAt) && validDate(item.updatedAt));
}

function isCleared(value: unknown): value is ClearedPosition {
  const item = value as Partial<ClearedPosition> | undefined;
  return Boolean(item && typeof item.id === 'string' && typeof item.positionId === 'string' && /^\d{6}$/.test(item.code ?? '') && typeof item.stockName === 'string' && typeof item.totalBuyAmount === 'number' && Number.isFinite(item.totalBuyAmount) && typeof item.totalSellAmount === 'number' && Number.isFinite(item.totalSellAmount) && typeof item.realizedProfit === 'number' && Number.isFinite(item.realizedProfit) && typeof item.returnPercent === 'number' && Number.isFinite(item.returnPercent) && typeof item.tradeCount === 'number' && Number.isInteger(item.tradeCount) && item.tradeCount > 0 && validDate(item.openedAt) && validDate(item.closedAt) && Array.isArray(item.trades) && item.trades.every(isTrade));
}

function validateTrade(code: string, price: number, shares: number): void {
  if (!/^\d{6}$/.test(code)) throw new Error('股票代码无效');
  if (!Number.isFinite(price) || price <= 0) throw new Error('成交价必须大于 0');
  if (!Number.isInteger(shares) || shares <= 0) throw new Error('成交股数必须为正整数');
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function cloneData(data: PortfolioData): PortfolioData {
  return { positions: data.positions.map((item) => ({ ...item })), trades: data.trades.map((item) => ({ ...item })), cleared: data.cleared.map((item) => ({ ...item, trades: item.trades.map((trade) => ({ ...trade })) })) };
}
