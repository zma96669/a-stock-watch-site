import { describe, expect, it, vi } from 'vitest';
import { GitHubApi, GitHubApiError } from '../src/services/github-api';

const json = (status: number, value: unknown) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

describe('GitHubApi', () => {
  it('loads the account and private repository with authenticated requests', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(json(200, { login: 'alice' }))
      .mockResolvedValueOnce(json(200, { owner: { login: 'alice' }, name: 'a-stock-watch-sync', private: true, html_url: 'https://github.com/alice/a-stock-watch-sync' }));
    const api = new GitHubApi('secret', request);
    await expect(api.authenticatedLogin()).resolves.toBe('alice');
    await expect(api.getRepository('alice', 'a-stock-watch-sync')).resolves.toMatchObject({ owner: 'alice', private: true });
    expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer secret');
  });

  it('creates a private repository', async () => {
    const request = vi.fn().mockResolvedValue(json(201, { owner: { login: 'alice' }, name: 'a-stock-watch-sync', private: true, html_url: 'https://github.com/alice/a-stock-watch-sync' }));
    const repository = await new GitHubApi('token', request).createPrivateRepository('a-stock-watch-sync');
    expect(repository.private).toBe(true);
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ name: 'a-stock-watch-sync', private: true });
  });

  it('reads and updates a base64 backup file with its SHA', async () => {
    const text = '{"format":"a-stock-watch-backup"}';
    const request = vi.fn()
      .mockResolvedValueOnce(json(200, { sha: 'old-sha', size: Buffer.byteLength(text), encoding: 'base64', content: Buffer.from(text).toString('base64') }))
      .mockResolvedValueOnce(json(200, { content: { sha: 'new-sha' } }));
    const api = new GitHubApi('token', request);
    await expect(api.getFile('alice', 'repo', 'watchlist.a-stock-watch.json', 1024)).resolves.toEqual({ sha: 'old-sha', text, size: Buffer.byteLength(text) });
    await expect(api.putFile('alice', 'repo', 'watchlist.a-stock-watch.json', text, 'old-sha')).resolves.toEqual({ sha: 'new-sha' });
    expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({ sha: 'old-sha', content: Buffer.from(text).toString('base64') });
  });

  it('returns undefined for missing resources and rejects unsafe responses', async () => {
    const missing = vi.fn().mockResolvedValue(json(404, { message: 'Not Found' }));
    await expect(new GitHubApi('token', missing).getRepository('alice', 'repo')).resolves.toBeUndefined();
    const forbidden = vi.fn().mockResolvedValue(json(403, { message: 'Resource not accessible' }));
    await expect(new GitHubApi('token', forbidden).authenticatedLogin()).rejects.toMatchObject({ status: 403 } satisfies Partial<GitHubApiError>);
    const oversized = vi.fn().mockResolvedValue(json(200, { sha: 'x', size: 2048, encoding: 'base64', content: '' }));
    await expect(new GitHubApi('token', oversized).getFile('alice', 'repo', 'file', 1024)).rejects.toThrow('超过 1 MB');
  });
});
