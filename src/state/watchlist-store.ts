import * as vscode from 'vscode';
import type { StockRef } from '../domain/types';

const KEY = 'aStockWatch.watchlist';

export class WatchlistStore {
  private stocks: StockRef[];
  private readonly emitter = new vscode.EventEmitter<readonly StockRef[]>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly state: vscode.Memento) {
    this.stocks = state.get<StockRef[]>(KEY, []);
  }

  getAll(): readonly StockRef[] {
    return this.stocks;
  }

  get(code: string): StockRef | undefined {
    return this.stocks.find((stock) => stock.code === code);
  }

  async add(stock: StockRef): Promise<void> {
    if (this.get(stock.code)) return;
    this.stocks = [...this.stocks, stock];
    await this.persist();
  }

  async remove(code: string): Promise<void> {
    this.stocks = this.stocks.filter((stock) => stock.code !== code);
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.state.update(KEY, this.stocks);
    this.emitter.fire(this.stocks);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

