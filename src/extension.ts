import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { BackgroundBridge } from './background/bridge-server';
import { BackgroundInstaller } from './background/installer';
import { StatusBarController } from './controllers/status-bar-controller';
import { AlertController } from './controllers/alert-controller';
import type { BackgroundOptions, StockRef } from './domain/types';
import { EastMoneyProvider } from './market/eastmoney-provider';
import { TencentProvider } from './market/tencent-provider';
import { TencentPrimaryProvider } from './market/fallback-provider';
import { createStockRef } from './market/stock-code';
import { searchStocks } from './market/stock-search';
import { QuoteService } from './services/quote-service';
import { WatchlistTransferService } from './services/watchlist-transfer-service';
import { GitHubSyncService } from './services/github-sync-service';
import { CurrentStockStore } from './state/current-stock-store';
import { BackgroundVisibilityStore } from './state/background-visibility-store';
import { SessionOpacityController } from './state/session-opacity-controller';
import { WatchlistStore } from './state/watchlist-store';
import { AlertStore } from './state/alert-store';
import { PortfolioStore } from './state/portfolio-store';
import { ChartPanel } from './views/chart-panel';
import { WatchlistWebviewProvider } from './views/watchlist-webview';

let service: QuoteService | undefined;
let bridge: BackgroundBridge | undefined;
const BACKGROUND_TOKEN_KEY = 'aStockWatch.backgroundBridgeToken';
const BACKGROUND_INDICATOR_KEY = 'indicator';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  let bridgeToken = context.globalState.get<string>(BACKGROUND_TOKEN_KEY);
  if (!bridgeToken) {
    bridgeToken = randomBytes(24).toString('hex');
    await context.globalState.update(BACKGROUND_TOKEN_KEY, bridgeToken);
  }
  const watchlist = new WatchlistStore(context.globalState);
  const alerts = new AlertStore(context.globalState);
  const portfolio = new PortfolioStore(context.globalState, () => watchlist.getEntries(), (code, costPrice, shares) => watchlist.updateHolding(code, costPrice, shares));
  const current = new CurrentStockStore(context.globalState);
  const backgroundVisibility = new BackgroundVisibilityStore(context.globalState);
  const sessionOpacity = new SessionOpacityController();
  const provider = new TencentPrimaryProvider(new TencentProvider(), new EastMoneyProvider());
  service = new QuoteService(
    provider,
    () => watchlist.getAll(),
    () => current.get(),
    () => vscode.workspace.getConfiguration('aStockWatch').get<number>('refreshInterval', 2),
    () => vscode.workspace.getConfiguration('aStockWatch').get<number>('intradayRefreshInterval', 5)
  );
  const watchlistView = new WatchlistWebviewProvider(context.extensionUri, watchlist, current, service, alerts, portfolio);
  const transfer = new WatchlistTransferService(context, watchlist, current, alerts, portfolio);
  const githubSync = new GitHubSyncService(context, transfer);
  const status = new StatusBarController(current, service);
  const alertController = new AlertController(alerts, service, () => watchlist.getEntries());
  const installer = new BackgroundInstaller(context);
  bridge = new BackgroundBridge(() => ({
    ...service?.getSnapshot(),
    background: backgroundOptions(backgroundVisibility.isVisible(), sessionOpacity)
  }), bridgeToken);
  let bridgeInfo: Awaited<ReturnType<BackgroundBridge['start']>> | undefined;
  try { bridgeInfo = await bridge.start(); } catch (error) { console.warn('A股盯盘背景桥接未启动', error); }
  try { await installer.reconcile(); } catch (error) { console.warn('A股盯盘背景安装状态同步失败', error); }

  context.subscriptions.push(
    watchlist, alerts, portfolio, current, watchlistView, status, alertController,
    vscode.window.registerWebviewViewProvider('aStockWatch.watchlist', watchlistView, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('aStockWatch.addStock', async () => {
      const input = await vscode.window.showInputBox({ prompt: '输入股票名称或六位代码', placeHolder: '例如 贵州茅台 或 600519' });
      if (!input) return;
      try {
        const rows = await searchStocks(input);
        if (!rows.length) throw new Error(`没有找到匹配的沪深 A 股：${input}`);
        const choice = rows.length === 1 ? rows[0] : await vscode.window.showQuickPick(rows.map((stock) => ({ label: stock.name, description: `${stock.code} · ${stock.market}`, stock })), { placeHolder: '选择要加入的股票' });
        const stock = choice && 'stock' in choice ? choice.stock : choice;
        if (!stock) return;
        const added = await watchlist.add(stock);
        if (!added) {
          void vscode.window.showInformationMessage(`${stock.name}（${stock.code}）已经在自选股中`);
          return;
        }
        if (!current.get()) await current.set(stock.code);
      } catch (error) { void vscode.window.showErrorMessage(`添加失败：${message(error)}`); }
    }),
    vscode.commands.registerCommand('aStockWatch.removeCurrent', async () => {
      if (service?.getSnapshot().currentIndexKey) return;
      const code = current.get(); if (!code) return;
      await watchlist.remove(code);
      await current.set(watchlist.getAll()[0]?.code);
    }),
    vscode.commands.registerCommand('aStockWatch.selectStock', async (code: string) => { await current.set(code); service?.selectStock(); }),
    vscode.commands.registerCommand('aStockWatch.previousStock', async () => { await rotate(-1, watchlist, current); service?.selectStock(); }),
    vscode.commands.registerCommand('aStockWatch.nextStock', async () => { await rotate(1, watchlist, current); service?.selectStock(); }),
    vscode.commands.registerCommand('aStockWatch.refresh', () => service?.refreshNow()),
    vscode.commands.registerCommand('aStockWatch.showAlerts', () => alertController.show()),
    vscode.commands.registerCommand('aStockWatch.testAlert', () => alertController.test()),
    vscode.commands.registerCommand('aStockWatch.markAlertsRead', (id?: string) => alertController.markRead(id)),
    vscode.commands.registerCommand('aStockWatch.muteAlertToday', (id: string) => alertController.muteToday(id)),
    vscode.commands.registerCommand('aStockWatch.muteAllAlertsToday', () => alertController.muteAllToday()),
    vscode.commands.registerCommand('aStockWatch.openChart', () => service && ChartPanel.show(context.extensionUri, service)),
    vscode.commands.registerCommand('aStockWatch.manageData', async () => { try { await transfer.manage(); } catch (error) { void vscode.window.showErrorMessage(`数据管理失败：${message(error)}`); } }),
    vscode.commands.registerCommand('aStockWatch.exportData', async () => { try { await transfer.exportData(); } catch (error) { void vscode.window.showErrorMessage(`导出失败：${message(error)}`); } }),
    vscode.commands.registerCommand('aStockWatch.importData', async () => { try { await transfer.importData(); } catch (error) { void vscode.window.showErrorMessage(`导入失败：${message(error)}`); } }),
    vscode.commands.registerCommand('aStockWatch.githubSync', async () => { try { await githubSync.manage(); } catch (error) { void vscode.window.showErrorMessage(`GitHub 同步失败：${message(error)}`); } }),
    vscode.commands.registerCommand('aStockWatch.githubUpload', async () => { try { await githubSync.upload(); } catch (error) { void vscode.window.showErrorMessage(`上传失败：${message(error)}`); } }),
    vscode.commands.registerCommand('aStockWatch.githubDownload', async () => { try { await githubSync.download(); } catch (error) { void vscode.window.showErrorMessage(`同步失败：${message(error)}`); } }),
    vscode.commands.registerCommand('aStockWatch.githubStatus', async () => { try { await githubSync.showStatus(); } catch (error) { void vscode.window.showErrorMessage(`同步状态读取失败：${message(error)}`); } }),
    vscode.commands.registerCommand('aStockWatch.githubUnlink', async () => { try { await githubSync.unlink(); } catch (error) { void vscode.window.showErrorMessage(`解除绑定失败：${message(error)}`); } }),
    vscode.commands.registerCommand('aStockWatch.toggleBackgroundVisibility', async () => {
      sessionOpacity.reset();
      await backgroundVisibility.toggle();
      bridge?.notify();
    }),
    vscode.commands.registerCommand('aStockWatch.increaseBackgroundOpacity', () => {
      sessionOpacity.increase(configuredBackgroundOpacity());
      bridge?.notify();
    }),
    vscode.commands.registerCommand('aStockWatch.decreaseBackgroundOpacity', () => {
      sessionOpacity.decrease(configuredBackgroundOpacity());
      bridge?.notify();
    }),
    vscode.commands.registerCommand('aStockWatch.toggleBackgroundIndicator', async () => {
      const config = vscode.workspace.getConfiguration('aStockWatch.background');
      const current = config.get<'volume' | 'macd'>(BACKGROUND_INDICATOR_KEY, 'volume');
      const next = current === 'macd' ? 'volume' : 'macd';
      await config.update(BACKGROUND_INDICATOR_KEY, next, vscode.ConfigurationTarget.Global);
      bridge?.notify();
      void vscode.window.setStatusBarMessage(`行情背景指标：${next === 'macd' ? 'MACD' : '成交额'}`, 2200);
    }),
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
    watchlist.onDidChange(() => { void service?.refreshQuotesNow(); }),
    current.onDidChange(() => service?.selectStock()),
    { dispose: service.subscribe(() => bridge?.notify()) }
  );
  service.start();
}

export async function deactivate(): Promise<void> {
  service?.stop();
  await bridge?.stop();
}

async function rotate(direction: number, watchlist: WatchlistStore, current: CurrentStockStore): Promise<void> {
  const stocks = watchlist.getAll(); if (!stocks.length) return;
  const index = Math.max(0, stocks.findIndex((stock) => stock.code === current.get()));
  await current.set(stocks[(index + direction + stocks.length) % stocks.length].code);
}

function backgroundOptions(visible: boolean, sessionOpacity: SessionOpacityController): BackgroundOptions {
  const config = vscode.workspace.getConfiguration('aStockWatch.background');
  return {
    visible,
    opacity: sessionOpacity.effective(config.get<number>('opacity', .08)),
    showAverage: config.get<boolean>('showAverage', true),
    showVolume: config.get<boolean>('showVolume', true),
    indicator: config.get<'volume' | 'macd'>(BACKGROUND_INDICATOR_KEY, 'volume') === 'macd' ? 'macd' : 'volume',
    lineWidth: config.get<number>('lineWidth', .75)
  };
}

function configuredBackgroundOpacity(): number {
  return vscode.workspace.getConfiguration('aStockWatch.background').get<number>('opacity', .08);
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

