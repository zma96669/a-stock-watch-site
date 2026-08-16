import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import type { BridgeInfo } from './bridge-server';
import { isManagedLoaderFileName, loaderFileNameForContent, loaderPathForWorkbench, loaderScriptTag } from './loader-install';
import { allowLocalBridge } from './workbench-patch';
import { workbenchCandidates } from './workbench-paths';

const START = '<!-- ASTOCK_WATCH_BACKGROUND_START -->';
const END = '<!-- ASTOCK_WATCH_BACKGROUND_END -->';
const META_KEY = 'aStockWatch.backgroundInstall';

interface InstallMeta { target: string; backup: string; loader?: string; originalHash: string; injectedHash: string; }

export class BackgroundInstaller {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async enable(info: BridgeInfo): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      '背景模式会修改 VS Code 工作台文件，更新 VS Code 后可能需要重新安装。稳定模式不受影响。',
      { modal: true }, '启用实验背景'
    );
    if (choice !== '启用实验背景') return;
    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    const template = await fs.readFile(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'background-loader.js').fsPath, 'utf8');
    const loader = template
      .replaceAll('__TOKEN__', info.token)
      .replaceAll('__PORT_START__', String(info.portStart))
      .replaceAll('__PORT_END__', String(info.portEnd));
    const target = await this.findWorkbench();
    const loaderFileName = loaderFileNameForContent(loader);
    const loaderPath = loaderPathForWorkbench(target, loaderFileName);
    await fs.writeFile(loaderPath, loader, 'utf8');
    const original = await fs.readFile(target, 'utf8');
    const clean = removeBlock(original);
    const backup = `${target}.astock-watch.backup`;
    await fs.writeFile(backup, clean, 'utf8');
    let patched = allowLocalBridge(clean);
    const block = `${START}\n${loaderScriptTag(loaderFileName)}\n${END}`;
    patched = patched.includes('</body>') ? patched.replace('</body>', `${block}\n</body>`) : `${patched}\n${block}`;
    await fs.writeFile(target, patched, 'utf8');
    const meta: InstallMeta = { target, backup, loader: loaderPath, originalHash: hash(clean), injectedHash: hash(patched) };
    await this.context.globalState.update(META_KEY, meta);
    await vscode.window.showInformationMessage('背景组件已安装，请重新加载 VS Code 窗口。', '重新加载').then((value) => {
      if (value === '重新加载') void vscode.commands.executeCommand('workbench.action.reloadWindow');
    });
  }

  async disable(showMessage = true): Promise<void> {
    const meta = this.context.globalState.get<InstallMeta>(META_KEY);
    if (!meta) {
      if (showMessage) void vscode.window.showInformationMessage('没有检测到已安装的背景组件。');
      return;
    }
    const current = await fs.readFile(meta.target, 'utf8');
    if (hash(current) !== meta.injectedHash) {
      throw new Error('VS Code 工作台文件已发生变化。为避免覆盖更新，已停止自动恢复；请执行“重新安装背景组件”。');
    }
    const backup = await fs.readFile(meta.backup, 'utf8');
    if (hash(backup) !== meta.originalHash) throw new Error('背景备份校验失败，未修改 VS Code 文件。');
    await fs.writeFile(meta.target, backup, 'utf8');
    if (meta.loader) await fs.rm(meta.loader, { force: true });
    await this.context.globalState.update(META_KEY, undefined);
    if (showMessage) {
      await vscode.window.showInformationMessage('背景组件已关闭，请重新加载窗口。', '重新加载').then((value) => {
        if (value === '重新加载') void vscode.commands.executeCommand('workbench.action.reloadWindow');
      });
    }
  }

  async repair(info: BridgeInfo): Promise<void> {
    try { await this.disable(false); } catch { /* New VS Code version: enable creates a fresh backup after removing our marker. */ }
    await this.context.globalState.update(META_KEY, undefined);
    await this.enable(info);
  }

  async reconcile(): Promise<void> {
    const meta = this.context.globalState.get<InstallMeta>(META_KEY);
    if (!meta) return;
    const [current, backup] = await Promise.all([
      fs.readFile(meta.target, 'utf8'),
      fs.readFile(meta.backup, 'utf8')
    ]);
    const clean = removeBlock(current);
    if (hash(clean) !== meta.originalHash || hash(backup) !== meta.originalHash) return;
    const fileName = activeLoaderFileName(current);
    if (!fileName) return;
    const loader = path.join(path.dirname(meta.target), fileName);
    try { await fs.access(loader); } catch { return; }
    if (meta.loader && meta.loader !== loader && canRemoveManagedLoader(meta.loader, meta.target)) {
      await fs.rm(meta.loader, { force: true });
    }
    await this.context.globalState.update(META_KEY, { ...meta, loader, injectedHash: hash(current) });
  }

  private async findWorkbench(): Promise<string> {
    for (const candidate of workbenchCandidates(vscode.env.appRoot)) {
      try { await fs.access(candidate); return candidate; } catch { /* try next */ }
    }
    throw new Error('未找到当前 VS Code 的工作台文件，稳定模式仍可正常使用。');
  }
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function removeBlock(value: string): string { return value.replace(new RegExp(`${START}[\\s\\S]*?${END}\\s*`, 'g'), ''); }

function activeLoaderFileName(value: string): string | undefined {
  const block = value.match(new RegExp(`${START}[\\s\\S]*?<script src="\\./([^"]+)"></script>[\\s\\S]*?${END}`));
  const fileName = block?.[1];
  return fileName && isManagedLoaderFileName(fileName) ? fileName : undefined;
}

function canRemoveManagedLoader(loader: string, target: string): boolean {
  return path.dirname(loader) === path.dirname(target) && isManagedLoaderFileName(path.basename(loader));
}
