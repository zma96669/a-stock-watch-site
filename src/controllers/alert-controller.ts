import * as vscode from 'vscode';
import type { AlertEvent, MarketSnapshot, WatchlistEntry } from '../domain/types';
import type { QuoteService } from '../services/quote-service';
import { AlertEngine } from '../services/alert-engine';
import type { AlertStore } from '../state/alert-store';

export class AlertController implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 45);
  private readonly engine: AlertEngine;
  private readonly subscriptions: vscode.Disposable[] = [];
  private processing = false;
  private queued?: MarketSnapshot;

  constructor(
    private readonly alerts: AlertStore,
    quotes: QuoteService,
    entries: () => readonly WatchlistEntry[]
  ) {
    this.engine = new AlertEngine(alerts, entries);
    this.item.command = 'aStockWatch.showAlerts';
    this.item.tooltip = '查看盘中提醒中心';
    this.subscriptions.push(
      { dispose: quotes.subscribe((snapshot) => { this.queued = snapshot; void this.processQueue(); }) },
      alerts.onDidChange(() => this.updateStatus())
    );
    this.updateStatus();
  }

  async test(): Promise<void> {
    const choice = await vscode.window.showInformationMessage('A股盯盘测试提醒：通知链路正常。', '查看提醒中心');
    if (choice === '查看提醒中心') await vscode.commands.executeCommand('aStockWatch.showAlerts');
  }

  async show(): Promise<void> {
    await this.alerts.markRead();
    void vscode.window.showInformationMessage(this.alerts.getEvents().length ? `今日已记录 ${this.alerts.getEvents().length} 条行情提醒` : '今天还没有触发行情提醒');
    this.updateStatus();
  }

  async markRead(id?: string): Promise<void> {
    await this.alerts.markRead(id);
    this.updateStatus();
  }

  async muteToday(ruleId: string): Promise<void> {
    await this.alerts.muteToday(ruleId);
  }

  private async processQueue(): Promise<void> {
    if (this.processing || !this.queued) return;
    this.processing = true;
    const snapshot = this.queued;
    this.queued = undefined;
    try {
      const events = await this.engine.evaluate(snapshot);
      for (const event of events) await this.notify(event);
      this.updateStatus();
    } finally {
      this.processing = false;
      if (this.queued) void this.processQueue();
    }
  }

  private async notify(event: AlertEvent): Promise<void> {
    if (event.severity === 'preview' || event.severity === 'normal') return;
    const action = await vscode.window.showWarningMessage(`${event.stockName}（${event.code}）${event.title}：${event.message}`, '查看走势', '今日不再提醒');
    if (action === '查看走势') {
      await vscode.commands.executeCommand('aStockWatch.selectStock', event.code);
      await vscode.commands.executeCommand('aStockWatch.openChart');
    }
    if (action === '今日不再提醒') await this.alerts.muteToday(event.ruleId);
  }

  private updateStatus(): void {
    const unread = this.alerts.unreadCount();
    this.item.text = unread ? `$(bell) 行情提醒 · ${unread}` : '$(bell) 行情提醒';
    this.item.show();
  }

  dispose(): void {
    this.subscriptions.splice(0).forEach((subscription) => subscription.dispose());
    this.item.dispose();
  }
}
