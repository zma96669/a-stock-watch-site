import * as vscode from 'vscode';
import type { QuoteService } from '../services/quote-service';
import type { CurrentStockStore } from '../state/current-stock-store';

export class StatusBarController implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  private readonly unsubscribe: () => void;

  constructor(current: CurrentStockStore, quotes: QuoteService) {
    this.item.command = 'aStockWatch.nextStock';
    this.item.tooltip = '点击切换下一只自选股';
    this.unsubscribe = quotes.subscribe((snapshot) => {
      const code = current.get();
      const quote = code ? snapshot.quotes[code] : undefined;
      if (!quote) {
        this.item.text = '$(graph) A股盯盘';
      } else {
        const percent = quote.changePercent == null ? '--' : `${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%`;
        this.item.text = `$(graph) ${quote.name} ${quote.price?.toFixed(2) ?? '--'} ${percent}${snapshot.stale ? ' $(warning)' : ''}`;
        this.item.color = quote.changePercent == null
          ? undefined
          : new vscode.ThemeColor(quote.changePercent >= 0 ? 'charts.red' : 'charts.green');
      }
      this.item.show();
    });
  }

  dispose(): void {
    this.unsubscribe();
    this.item.dispose();
  }
}

