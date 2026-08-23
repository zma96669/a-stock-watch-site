import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('watchlist webview initialization', () => {
  it('registers the ready-message listener before loading the page HTML', () => {
    const source = readFileSync(resolve('src/views/watchlist-webview.ts'), 'utf8');
    const method = source.slice(source.indexOf('resolveWebviewView('), source.indexOf('showSearch():'));
    expect(method.indexOf('onDidReceiveMessage')).toBeGreaterThan(-1);
    expect(method.indexOf('webview.html =')).toBeGreaterThan(method.indexOf('onDidReceiveMessage'));
    expect(source).toContain("vscode.postMessage({type:'ready'})");
    expect(source).toContain("case 'ready':");
  });
});
