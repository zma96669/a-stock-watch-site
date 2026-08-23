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

  it('embeds the current state and renders before the ready-state round trip', () => {
    const source = readFileSync(resolve('src/views/watchlist-webview.ts'), 'utf8');
    expect(source).toContain('payload: this.statePayload()');
    expect(source).toContain('serializeForInlineScript(this.statePayload())');
    expect(source).toContain('let state=${initialState}');
    expect(source).not.toContain('let state={groups:[],entries:[]');
    expect(source.indexOf('renderSafely();vscode.postMessage')).toBeGreaterThan(-1);
  });

  it('shows page-level rendering errors inside the webview', () => {
    const source = readFileSync(resolve('src/views/watchlist-webview.ts'), 'utf8');
    expect(source).toContain("window.addEventListener('error'");
    expect(source).toContain("window.addEventListener('unhandledrejection'");
    expect(source).toContain("showError('自选股渲染失败：'");
  });
});
