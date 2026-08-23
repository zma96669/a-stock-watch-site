import { beforeEach, describe, expect, it, vi } from 'vitest';

const { showQuickPick, showWarningMessage, showInformationMessage } = vi.hoisted(() => ({
  showQuickPick: vi.fn(),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn()
}));

vi.mock('vscode', () => ({
  window: { showQuickPick, showWarningMessage, showInformationMessage },
  authentication: { getSession: vi.fn() }
}));

import { createPortableBackup, serializePortableBackup } from '../src/data/portable-watchlist';
import type { GitHubApi } from '../src/services/github-api';
import { GitHubSyncService, type GitHubSyncBinding, type GitHubSyncDependencies } from '../src/services/github-sync-service';
import type { WatchlistTransferService } from '../src/services/watchlist-transfer-service';

const backup = createPortableBackup({
  groups: [{ id: 'default', name: '我的关注', sortOrder: 0, collapsed: false }],
  entries: [{ code: '000001', secid: '0.000001', market: 'SZ', name: '平安银行', groupId: 'default', sortOrder: 0, followed: true }]
}, '000001', '0.1.30', new Date('2026-08-23T10:00:00.000Z'));

const repository = { owner: 'alice', name: 'a-stock-watch-sync', private: true, htmlUrl: 'https://github.com/alice/a-stock-watch-sync' };

function harness(options: { binding?: GitHubSyncBinding; api?: Partial<GitHubApi>; transfer?: Partial<WatchlistTransferService> } = {}) {
  let saved: unknown = options.binding;
  const globalState = {
    get: () => saved,
    update: vi.fn(async (_key: string, value: unknown) => { saved = value; })
  };
  const api = {
    authenticatedLogin: vi.fn(async () => 'alice'),
    getRepository: vi.fn(async () => repository),
    createPrivateRepository: vi.fn(async () => repository),
    getFile: vi.fn(async () => undefined),
    putFile: vi.fn(async () => ({ sha: 'uploaded-sha' })),
    ...options.api
  } as unknown as GitHubApi;
  const transfer = {
    currentBackup: vi.fn(() => backup),
    applyBackup: vi.fn(async () => ({ fsPath: 'C:\\backup.json' })),
    ...options.transfer
  } as unknown as WatchlistTransferService;
  const dependencies: GitHubSyncDependencies = {
    getSession: vi.fn(async () => ({ accessToken: 'token' })),
    createApi: vi.fn(() => api),
    now: () => new Date('2026-08-23T11:00:00.000Z')
  };
  const service = new GitHubSyncService({ globalState } as never, transfer, dependencies);
  return { service, api, transfer, globalState, saved: () => saved, dependencies };
}

describe('GitHubSyncService', () => {
  beforeEach(() => {
    showQuickPick.mockReset();
    showWarningMessage.mockReset();
    showInformationMessage.mockReset();
  });

  it('creates a missing private repository and uploads the current backup', async () => {
    const createPrivateRepository = vi.fn(async () => repository);
    const putFile = vi.fn(async () => ({ sha: 'uploaded-sha' }));
    const { service, saved } = harness({ api: { getRepository: vi.fn(async () => undefined), createPrivateRepository, putFile } });
    await service.upload();
    expect(createPrivateRepository).toHaveBeenCalledWith('a-stock-watch-sync');
    expect(putFile).toHaveBeenCalledWith('alice', 'a-stock-watch-sync', 'watchlist.a-stock-watch.json', expect.stringContaining('a-stock-watch-backup'), undefined);
    expect(saved()).toMatchObject({ owner: 'alice', repository: 'a-stock-watch-sync', lastKnownSha: 'uploaded-sha', lastSyncedAt: '2026-08-23T11:00:00.000Z' });
  });

  it('syncs first instead of overwriting when another computer changed the SHA', async () => {
    const binding: GitHubSyncBinding = { ...repositoryBinding(), lastKnownSha: 'local-sha' };
    const remote = { sha: 'remote-sha', text: serializePortableBackup(backup), size: 100 };
    const putFile = vi.fn();
    showWarningMessage.mockResolvedValue('先同步');
    const { service, transfer, saved } = harness({ binding, api: { getFile: vi.fn(async () => remote), putFile } });
    await service.upload();
    expect(transfer.applyBackup).toHaveBeenCalledWith(expect.objectContaining({ format: 'a-stock-watch-backup' }), 'merge');
    expect(putFile).not.toHaveBeenCalled();
    expect(saved()).toMatchObject({ lastKnownSha: 'remote-sha', lastSyncedAt: '2026-08-23T11:00:00.000Z' });
  });

  it('downloads and intelligently merges a valid cloud backup', async () => {
    const remote = { sha: 'remote-sha', text: serializePortableBackup(backup), size: 100 };
    const { service, transfer, saved } = harness({ binding: repositoryBinding(), api: { getFile: vi.fn(async () => remote) } });
    await service.download();
    expect(transfer.applyBackup).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Object) }), 'merge');
    expect(saved()).toMatchObject({ lastKnownSha: 'remote-sha' });
  });

  it('rejects public repositories and corrupted cloud data without applying it', async () => {
    const publicRepository = { ...repository, private: false };
    const first = harness({ api: { getRepository: vi.fn(async () => publicRepository) } });
    await expect(first.service.download()).rejects.toThrow('不是私有仓库');
    expect(first.transfer.applyBackup).not.toHaveBeenCalled();

    const second = harness({ binding: repositoryBinding(), api: { getFile: vi.fn(async () => ({ sha: 'x', text: '{', size: 1 })) } });
    await expect(second.service.download()).rejects.toThrow('有效的 JSON');
    expect(second.transfer.applyBackup).not.toHaveBeenCalled();
  });

  it('unlinks locally without deleting the remote repository', async () => {
    showWarningMessage.mockResolvedValue('解除绑定');
    const { service, globalState, saved } = harness({ binding: repositoryBinding() });
    await service.unlink();
    expect(globalState.update).toHaveBeenLastCalledWith('aStockWatch.githubSync.binding', undefined);
    expect(saved()).toBeUndefined();
  });
});

function repositoryBinding(): GitHubSyncBinding {
  return { owner: repository.owner, repository: repository.name, repositoryUrl: repository.htmlUrl };
}
