import { homedir } from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import {
  createPortableBackup,
  mergePortableBackup,
  parsePortableBackup,
  restorePortableBackup,
  serializePortableBackup,
  type PortableWatchlistBackup
} from '../data/portable-watchlist';
import { applyImportTransaction } from '../data/import-transaction';
import type { CurrentStockStore } from '../state/current-stock-store';
import type { WatchlistStore } from '../state/watchlist-store';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export class WatchlistTransferService {
  private readonly pluginVersion: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly watchlist: WatchlistStore,
    private readonly current: CurrentStockStore
  ) {
    this.pluginVersion = String(context.extension.packageJSON.version ?? 'unknown');
  }

  async manage(): Promise<void> {
    const action = await vscode.window.showQuickPick([
      { label: '$(export) 导出数据', description: '备份自选股、分组、排序和持仓', value: 'export' },
      { label: '$(cloud-upload) 导入数据', description: '从另一台电脑的备份恢复或合并', value: 'import' }
    ], { placeHolder: '自选股数据管理' });
    if (action?.value === 'export') await this.exportData();
    if (action?.value === 'import') await this.importData();
  }

  async exportData(): Promise<void> {
    const destination = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(homedir(), `a-stock-watch-${dateStamp(new Date())}.a-stock-watch.json`)),
      filters: { 'A股盯盘备份': ['json'] },
      saveLabel: '导出备份'
    });
    if (!destination) return;
    const backup = createPortableBackup(this.watchlist.snapshot(), this.current.get(), this.pluginVersion);
    await vscode.workspace.fs.writeFile(destination, encode(serializePortableBackup(backup)));
    void vscode.window.showInformationMessage(`A股盯盘数据已导出：${destination.fsPath}`);
  }

  async importData(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      filters: { 'A股盯盘备份': ['json'] },
      openLabel: '选择备份文件'
    });
    const source = selected?.[0];
    if (!source) return;
    const stat = await vscode.workspace.fs.stat(source);
    if (stat.size > MAX_IMPORT_BYTES) throw new Error('备份文件超过 5 MB，已拒绝导入');
    const backup = parsePortableBackup(decode(await vscode.workspace.fs.readFile(source)));
    const mode = await vscode.window.showQuickPick([
      { label: '智能合并（推荐）', description: '保留本机独有股票，重复股票采用备份中的配置', value: 'merge' },
      { label: '完整恢复', description: '用备份完全替换本机自选股、分组和持仓', value: 'replace' }
    ], { placeHolder: `备份时间：${new Date(backup.exportedAt).toLocaleString()}` });
    if (!mode) return;
    if (mode.value === 'replace') {
      const confirmed = await vscode.window.showWarningMessage(
        '完整恢复会替换本机全部自选股、分组、排序和持仓。导入前会自动创建恢复备份。',
        { modal: true },
        '完整恢复'
      );
      if (confirmed !== '完整恢复') return;
    }
    const result = mode.value === 'replace'
      ? 'replace'
      : 'merge';
    const recoveryUri = await this.applyBackup(backup, result);
    void vscode.window.showInformationMessage(`数据导入完成（${result === 'replace' ? '完整恢复' : '智能合并'}）。恢复备份：${recoveryUri.fsPath}`);
  }

  currentBackup(): PortableWatchlistBackup {
    return createPortableBackup(this.watchlist.snapshot(), this.current.get(), this.pluginVersion);
  }

  async applyBackup(backup: PortableWatchlistBackup, mode: 'merge' | 'replace'): Promise<vscode.Uri> {
    const beforeWatchlist = this.watchlist.snapshot();
    const beforeCurrent = this.current.get();
    const recovery = createPortableBackup(beforeWatchlist, beforeCurrent, this.pluginVersion);
    const recoveryUri = await this.writeRecoveryBackup(recovery);
    const result = mode === 'replace'
      ? restorePortableBackup(backup)
      : mergePortableBackup(beforeWatchlist, beforeCurrent, backup);
    await applyImportTransaction(result, { watchlist: beforeWatchlist, currentCode: beforeCurrent }, {
      replaceWatchlist: (data) => this.watchlist.replace(data),
      setCurrentCode: (code) => this.current.set(code)
    }).catch((error) => { throw new Error(`${errorMessage(error)}；恢复文件：${recoveryUri.fsPath}`); });
    return recoveryUri;
  }

  private async writeRecoveryBackup(backup: ReturnType<typeof createPortableBackup>): Promise<vscode.Uri> {
    const directory = vscode.Uri.joinPath(this.context.globalStorageUri, 'backups');
    await vscode.workspace.fs.createDirectory(directory);
    const uri = vscode.Uri.joinPath(directory, `before-import-${dateStamp(new Date())}.a-stock-watch.json`);
    await vscode.workspace.fs.writeFile(uri, encode(serializePortableBackup(backup)));
    return uri;
  }
}

function dateStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decode(value: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
