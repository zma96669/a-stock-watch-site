import * as vscode from 'vscode';
import type { MarketSnapshot } from '../domain/types';
import type { QuoteService } from '../services/quote-service';

export class ChartPanel implements vscode.Disposable {
  private static instance?: ChartPanel;
  private readonly panel: vscode.WebviewPanel;
  private readonly unsubscribe: () => void;

  static show(extensionUri: vscode.Uri, quotes: QuoteService): ChartPanel {
    if (this.instance) {
      this.instance.panel.reveal(vscode.ViewColumn.Beside);
      this.instance.update(quotes.getSnapshot());
      return this.instance;
    }
    this.instance = new ChartPanel(extensionUri, quotes);
    return this.instance;
  }

  private constructor(extensionUri: vscode.Uri, quotes: QuoteService) {
    this.panel = vscode.window.createWebviewPanel('aStockWatch.chart', 'A股分时图', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
    });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'stock.svg');
    this.panel.webview.html = this.html(extensionUri);
    this.panel.onDidDispose(() => this.dispose());
    this.unsubscribe = quotes.subscribe((snapshot) => this.update(snapshot));
  }

  update(snapshot: MarketSnapshot): void {
    void this.panel.webview.postMessage({ type: 'snapshot', payload: snapshot });
  }

  private html(extensionUri: vscode.Uri): string {
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chart.js'));
    const nonce = Math.random().toString(36).slice(2);
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this.panel.webview.cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{width:100%;height:100%;margin:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family)}
#root{height:100%;display:grid;grid-template-rows:auto 1fr}.header{padding:12px 16px;border-bottom:1px solid var(--vscode-panel-border)}
.name{font-weight:700;font-size:16px}.meta{margin-top:5px;opacity:.75}.stale{color:var(--vscode-editorWarning-foreground)}
.chart{position:relative;min-height:240px}canvas{position:absolute;inset:0;width:100%;height:100%}#tip{position:absolute;display:none;padding:5px 8px;background:var(--vscode-editorHoverWidget-background);border:1px solid var(--vscode-editorHoverWidget-border);font-size:12px;pointer-events:none}
</style></head><body><div id="root"><div class="header"><div class="name" id="name">请选择股票</div><div class="meta" id="meta"></div></div><div class="chart"><canvas id="chart"></canvas><div id="tip"></div></div></div>
<script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
  }

  dispose(): void {
    if (ChartPanel.instance === this) ChartPanel.instance = undefined;
    this.unsubscribe();
  }
}

