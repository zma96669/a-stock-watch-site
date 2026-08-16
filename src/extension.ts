import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { BackgroundBridge } from './background/bridge-server';
import { BackgroundInstaller } from './background/installer';
import { StatusBarController } from './controllers/status-bar-controller';
import type { BackgroundOptions, StockRef } from './domain/types';
import { EastMoneyProvider } from './market/eastmoney-provider';
import { createStockRef } from './market/stock-code';
import { QuoteService } from './services/quote-service';
import { CurrentStockStore } from './state/current-stock-store';
import { WatchlistStore } from './state/watchlist-store';
import { ChartPanel } from './views/chart-panel';
import { WatchlistTreeProvider } from './views/watchlist-tree';

let service: QuoteService | undefined;
let bridge: BackgroundBridge | undefined;
const BACKGROUND_TOKEN_KEY = 'aStockWatch.backgroundBridgeToken';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  let bridgeToken = context.globalState.get<string>(BACKGROUND_TOKEN_KEY);
  if (!bridgeToken) {
    bridgeToken = randomBytes(24).toString('hex');
    await context.globalState.update(BACKGROUND_TOKEN_KEY, bridgeToken);
  }
  const watchlist = new WatchlistStore(context.globalState);
  const current = new CurrentStockStore(context.globalState);
  const provider = new EastMoneyProvider();
  service = new QuoteService(
    provider,
    () => watchlist.getAll(),
    () => current.get(),
    () => vscode.workspace.getConfiguration('aStockWatch').get<number>('refreshInterval', 5)
  );
  const tree = new WatchlistTreeProvider(watchlist, current, service);
  const status = new StatusBarController(current, service);
  const installer = new BackgroundInstaller(context);
  bridge = new BackgroundBridge(() => ({ ...service?.getSnapshot(), background: backgroundOptions() }), bridgeToken);
  let bridgeInfo: Awaited<ReturnType<BackgroundBridge['start']>> | undefined;
  try { bridgeInfo = await bridge.start(); } catch (error) { console.warn('A股盯盘背景桥接未启动', error); }

  context.subscriptions.push(
    watchlist, current, tree, status,
    vscode.window.registerTreeDataProvider('aStockWatch.watchlist', tree),
    vscode.commands.registerCommand('aStockWatch.addStock', async () => {
      const input = await vscode.window.showInputBox({ prompt: '输入六位 A 股代码', placeHolder: '例如 600519', validateInput: (value) => { try { createStockRef(value); return undefined; } catch (error) { return (error as Error).message; } } });
      if (!input) return;
      try {
        const candidate = createStockRef(input);
        const [quote] = await provider.fetchQuotes([candidate]);
        if (!quote) throw new Error(`没有找到股票 ${candidate.code}`);
        const stock: StockRef = { code: quote.code, secid: quote.secid, market: quote.market, name: quote.name };
        await watchlist.add(stock);
        if (!current.get()) await current.set(stock.code);
        tree.refresh(); await service?.refreshNow();
      } catch (error) { void vscode.window.showErrorMessage(`添加失败：${message(error)}`); }
    }),
    vscode.commands.registerCommand('aStockWatch.removeCurrent', async () => {
      const code = current.get(); if (!code) return;
      await watchlist.remove(code);
      await current.set(watchlist.getAll()[0]?.code);
      tree.refresh(); await service?.refreshNow();
    }),
    vscode.commands.registerCommand('aStockWatch.selectStock', async (code: string) => { await current.set(code); tree.refresh(); await service?.refreshNow(); }),
    vscode.commands.registerCommand('aStockWatch.previousStock', () => rotate(-1, watchlist, current, tree)),
    vscode.commands.registerCommand('aStockWatch.nextStock', () => rotate(1, watchlist, current, tree)),
    vscode.commands.registerCommand('aStockWatch.refresh', () => service?.refreshNow()),
    vscode.commands.registerCommand('aStockWatch.openChart', () => service && ChartPanel.show(context.extensionUri, service)),
    vscode.commands.registerCommand('aStockWatch.enableBackground', async () => {
      if (!bridgeInfo) bridgeInfo = await bridge?.start();
      if (!bridgeInfo) throw new Error('背景行情桥接启动失败');
      try { await installer.enable(bridgeInfo); } catch (error) { void vscode.window.showErrorMessage(`启用背景失败：${message(error)}`); }
    }),
    vscode.commands.registerCommand('aStockWatch.disableBackground', async () => { try { await installer.disable(); } catch (error) { void vscode.window.showErrorMessage(message(error)); } }),
    vscode.commands.registerCommand('aStockWatch.repairBackground', async () => {
      if (!bridgeInfo) bridgeInfo = await bridge?.start();
      if (!bridgeInfo) return;
      try { await installer.repair(bridgeInfo); } catch (error) { void vscode.window.showErrorMessage(`修复失败：${message(error)}`); }
    }),
    watchlist.onDidChange(() => { tree.refresh(); void service?.refreshNow(); }),
    current.onDidChange(() => { tree.refresh(); void service?.refreshNow(); })
  );
  service.start();
}

export async function deactivate(): Promise<void> {
  service?.stop();
  await bridge?.stop();
}

async function rotate(direction: number, watchlist: WatchlistStore, current: CurrentStockStore, tree: WatchlistTreeProvider): Promise<void> {
  const stocks = watchlist.getAll(); if (!stocks.length) return;
  const index = Math.max(0, stocks.findIndex((stock) => stock.code === current.get()));
  await current.set(stocks[(index + direction + stocks.length) % stocks.length].code);
  tree.refresh(); await service?.refreshNow();
}

function backgroundOptions(): BackgroundOptions {
  const config = vscode.workspace.getConfiguration('aStockWatch.background');
  return {
    opacity: config.get<number>('opacity', .12),
    showAverage: config.get<boolean>('showAverage', true),
    showVolume: config.get<boolean>('showVolume', false),
    lineWidth: config.get<number>('lineWidth', 1.5)
  };
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

