import * as vscode from 'vscode';
import type { MarketSnapshot, StockRef } from '../domain/types';
import type { QuoteService } from '../services/quote-service';
import type { CurrentStockStore } from '../state/current-stock-store';
import type { WatchlistStore } from '../state/watchlist-store';

export class WatchlistTreeProvider implements vscode.TreeDataProvider<StockRef>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<StockRef | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private snapshot: MarketSnapshot = { quotes: {}, intraday: [], stale: false };
  private readonly unsubscribe: () => void;

  constructor(
    private readonly watchlist: WatchlistStore,
    private readonly current: CurrentStockStore,
    quoteService: QuoteService
  ) {
    this.unsubscribe = quoteService.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.refresh();
    });
  }

  getTreeItem(stock: StockRef): vscode.TreeItem {
    const quote = this.snapshot.quotes[stock.code];
    const selected = stock.code === this.current.get();
    const item = new vscode.TreeItem(quote?.name || stock.name || stock.code, vscode.TreeItemCollapsibleState.None);
    item.description = quote?.price == null
      ? `${stock.code}  --`
      : `${stock.code}  ${quote.price.toFixed(2)}  ${formatPercent(quote.changePercent)}`;
    item.tooltip = new vscode.MarkdownString([
      `**${quote?.name || stock.name || stock.code}**`,
      '',
      `代码：${stock.code}`,
      `最新：${quote?.price?.toFixed(2) ?? '--'}`,
      `涨跌：${formatPercent(quote?.changePercent)}`,
      this.snapshot.stale ? '$(warning) 数据可能已延迟' : ''
    ].join('\n\n'));
    item.iconPath = new vscode.ThemeIcon(selected ? 'eye' : 'graph-line');
    item.contextValue = selected ? 'currentStock' : 'stock';
    item.command = { command: 'aStockWatch.selectStock', title: '选择股票', arguments: [stock.code] };
    return item;
  }

  getChildren(): StockRef[] {
    return [...this.watchlist.getAll()];
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  dispose(): void {
    this.unsubscribe();
    this.emitter.dispose();
  }
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

