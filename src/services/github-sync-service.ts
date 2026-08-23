import * as vscode from 'vscode';
import { parsePortableBackup, serializePortableBackup } from '../data/portable-watchlist';
import { GitHubApi, type GitHubFile } from './github-api';
import type { WatchlistTransferService } from './watchlist-transfer-service';

const BINDING_KEY = 'aStockWatch.githubSync.binding';
const REPOSITORY_NAME = 'a-stock-watch-sync';
const BACKUP_PATH = 'watchlist.a-stock-watch.json';
const MAX_CLOUD_BYTES = 5 * 1024 * 1024;

export interface GitHubSyncBinding {
  owner: string;
  repository: string;
  repositoryUrl: string;
  lastKnownSha?: string;
  lastSyncedAt?: string;
}

interface GitHubSession {
  accessToken: string;
}

export interface GitHubSyncDependencies {
  getSession(createIfNone: boolean): Promise<GitHubSession | undefined>;
  createApi(token: string): GitHubApi;
  now(): Date;
}

const defaultDependencies: GitHubSyncDependencies = {
  getSession: async (createIfNone) => vscode.authentication.getSession('github', ['repo'], { createIfNone }),
  createApi: (token) => new GitHubApi(token),
  now: () => new Date()
};

export class GitHubSyncService {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly transfer: WatchlistTransferService,
    private readonly dependencies: GitHubSyncDependencies = defaultDependencies
  ) {}

  async manage(): Promise<void> {
    const action = await vscode.window.showQuickPick([
      { label: '$(cloud-upload) 上传到 GitHub', description: '用本机数据更新私有云端备份', value: 'upload' },
      { label: '$(cloud-download) 从 GitHub 同步', description: '智能合并云端数据与本机数据', value: 'download' },
      { label: '$(info) 查看同步状态', description: '查看账号、仓库和最后同步时间', value: 'status' },
      { label: '$(debug-disconnect) 解除绑定', description: '只清除插件关联，不删除 GitHub 仓库', value: 'unlink' }
    ], { placeHolder: 'GitHub 私有云同步' });
    if (action?.value === 'upload') await this.upload();
    if (action?.value === 'download') await this.download();
    if (action?.value === 'status') await this.showStatus();
    if (action?.value === 'unlink') await this.unlink();
  }

  async upload(): Promise<void> {
    const connection = await this.connect(true);
    if (!connection) return;
    const remote = await connection.api.getFile(connection.binding.owner, connection.binding.repository, BACKUP_PATH, MAX_CLOUD_BYTES);
    if (remote) parsePortableBackup(remote.text);
    const changed = remote && remote.sha !== connection.binding.lastKnownSha;
    if (changed) {
      const action = await vscode.window.showWarningMessage(
        connection.binding.lastKnownSha
          ? '云端备份已被另一台电脑更新。直接覆盖会丢失那台电脑尚未同步到本机的配置。'
          : '这个 GitHub 仓库中已经有一份备份。建议先同步到本机，确认数据后再上传。',
        { modal: true },
        '先同步',
        '覆盖云端'
      );
      if (action === '先同步') {
        await this.downloadFrom(connection.api, connection.binding, remote);
        return;
      }
      if (action !== '覆盖云端') return;
    }
    if (!remote && connection.binding.lastKnownSha) {
      const confirmed = await vscode.window.showWarningMessage(
        '云端备份文件已被删除。是否用本机数据重新创建？',
        { modal: true },
        '重新创建'
      );
      if (confirmed !== '重新创建') return;
    }
    const text = serializePortableBackup(this.transfer.currentBackup());
    if (Buffer.byteLength(text, 'utf8') > MAX_CLOUD_BYTES) throw new Error('本机备份超过 5 MB，已拒绝上传');
    const uploaded = await connection.api.putFile(connection.binding.owner, connection.binding.repository, BACKUP_PATH, text, remote?.sha);
    await this.saveBinding({ ...connection.binding, lastKnownSha: uploaded.sha, lastSyncedAt: this.dependencies.now().toISOString() });
    void vscode.window.showInformationMessage(`已上传到 GitHub 私有仓库：${connection.binding.owner}/${connection.binding.repository}`);
  }

  async download(): Promise<void> {
    const connection = await this.connect(true);
    if (!connection) return;
    const remote = await connection.api.getFile(connection.binding.owner, connection.binding.repository, BACKUP_PATH, MAX_CLOUD_BYTES);
    if (!remote) throw new Error('GitHub 私有仓库中还没有备份，请先在有数据的电脑上上传');
    await this.downloadFrom(connection.api, connection.binding, remote);
  }

  async showStatus(): Promise<void> {
    const saved = this.getBinding();
    if (!saved) {
      void vscode.window.showInformationMessage('A股盯盘尚未绑定 GitHub；首次上传或同步时会自动登录并创建私有仓库。');
      return;
    }
    const session = await this.dependencies.getSession(false);
    if (!session) {
      void vscode.window.showInformationMessage(`已绑定 ${saved.owner}/${saved.repository}，但 VS Code 当前未登录对应 GitHub 账号。`);
      return;
    }
    const api = this.dependencies.createApi(session.accessToken);
    const login = await api.authenticatedLogin();
    if (login.toLowerCase() !== saved.owner.toLowerCase()) throw new Error(`当前登录账号是 ${login}，绑定账号是 ${saved.owner}`);
    const repository = await api.getRepository(saved.owner, saved.repository);
    if (!repository) throw new Error('已绑定的 GitHub 仓库不存在');
    assertPrivate(repository.private);
    const remote = await api.getFile(saved.owner, saved.repository, BACKUP_PATH, MAX_CLOUD_BYTES);
    if (remote) parsePortableBackup(remote.text);
    const lastSynced = saved.lastSyncedAt ? new Date(saved.lastSyncedAt).toLocaleString() : '尚未完成同步';
    const remoteState = remote ? (remote.sha === saved.lastKnownSha ? '与本机同步记录一致' : '有其他电脑的新版本') : '尚无云端备份';
    void vscode.window.showInformationMessage(`${saved.owner}/${saved.repository} · ${remoteState} · 最后同步：${lastSynced}`);
  }

  async unlink(): Promise<void> {
    const saved = this.getBinding();
    if (!saved) {
      void vscode.window.showInformationMessage('当前没有 GitHub 云同步绑定。');
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `解除与 ${saved.owner}/${saved.repository} 的绑定？远端私有仓库和本机数据都不会被删除。`,
      { modal: true },
      '解除绑定'
    );
    if (confirmed !== '解除绑定') return;
    await this.context.globalState.update(BINDING_KEY, undefined);
    void vscode.window.showInformationMessage('已解除 GitHub 云同步绑定，远端仓库未删除。');
  }

  private async connect(createIfNone: boolean): Promise<{ api: GitHubApi; binding: GitHubSyncBinding } | undefined> {
    const session = await this.dependencies.getSession(createIfNone);
    if (!session) return undefined;
    const api = this.dependencies.createApi(session.accessToken);
    const login = await api.authenticatedLogin();
    const existing = this.getBinding();
    if (existing && existing.owner.toLowerCase() !== login.toLowerCase()) {
      const confirmed = await vscode.window.showWarningMessage(
        `插件当前绑定 ${existing.owner}，VS Code 登录的是 ${login}。是否改绑到当前账号？`,
        { modal: true },
        '绑定当前账号'
      );
      if (confirmed !== '绑定当前账号') return undefined;
    }
    let repository = await api.getRepository(login, REPOSITORY_NAME);
    if (!repository) repository = await api.createPrivateRepository(REPOSITORY_NAME);
    assertPrivate(repository.private);
    const sameBinding = existing && existing.owner.toLowerCase() === repository.owner.toLowerCase() && existing.repository === repository.name;
    const binding: GitHubSyncBinding = sameBinding
      ? { ...existing, repositoryUrl: repository.htmlUrl }
      : { owner: repository.owner, repository: repository.name, repositoryUrl: repository.htmlUrl };
    await this.saveBinding(binding);
    return { api, binding };
  }

  private async downloadFrom(api: GitHubApi, binding: GitHubSyncBinding, remote: GitHubFile): Promise<void> {
    const backup = parsePortableBackup(remote.text);
    const recovery = await this.transfer.applyBackup(backup, 'merge');
    await this.saveBinding({ ...binding, lastKnownSha: remote.sha, lastSyncedAt: this.dependencies.now().toISOString() });
    void vscode.window.showInformationMessage(`GitHub 云端数据已智能合并。恢复备份：${recovery.fsPath}`);
  }

  private getBinding(): GitHubSyncBinding | undefined {
    const value = this.context.globalState.get<unknown>(BINDING_KEY);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const row = value as Partial<GitHubSyncBinding>;
    if (typeof row.owner !== 'string' || typeof row.repository !== 'string' || typeof row.repositoryUrl !== 'string') return undefined;
    if (row.lastKnownSha !== undefined && typeof row.lastKnownSha !== 'string') return undefined;
    if (row.lastSyncedAt !== undefined && (typeof row.lastSyncedAt !== 'string' || !Number.isFinite(Date.parse(row.lastSyncedAt)))) return undefined;
    return { owner: row.owner, repository: row.repository, repositoryUrl: row.repositoryUrl, ...(row.lastKnownSha ? { lastKnownSha: row.lastKnownSha } : {}), ...(row.lastSyncedAt ? { lastSyncedAt: row.lastSyncedAt } : {}) };
  }

  private async saveBinding(binding: GitHubSyncBinding): Promise<void> {
    await this.context.globalState.update(BINDING_KEY, binding);
  }
}

function assertPrivate(isPrivate: boolean): void {
  if (!isPrivate) throw new Error('同名 GitHub 仓库不是私有仓库。为避免泄露持仓数据，已拒绝同步');
}
