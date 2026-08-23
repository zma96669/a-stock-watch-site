import { describe, expect, it, vi } from 'vitest';
import { transformSync } from 'esbuild';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  }
}));

import { WatchlistWebviewProvider } from '../src/views/watchlist-webview';

describe('watchlist webview generated script', () => {
  it('is valid JavaScript for a populated watchlist', () => {
    const provider = new WatchlistWebviewProvider(
      {} as never,
      {
        getGroups: () => [{ id: 'default', name: '默认分组', sortOrder: 0, collapsed: false }],
        getEntries: () => [{ code: '600519', secid: '1.600519', market: 'SH', name: '贵州茅台', groupId: 'default', sortOrder: 0 }],
        onDidChange: () => ({ dispose() {} })
      } as never,
      { get: () => '600519', onDidChange: () => ({ dispose() {} }) } as never,
      { subscribe: () => ({ dispose() {} }) } as never
    );
    const html = (provider as unknown as { html(webview: { cspSource: string }): string }).html({ cspSource: 'vscode-webview:' });
    const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => transformSync(script!, { loader: 'js' })).not.toThrow();
  });
});
