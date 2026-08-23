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
    expect(source).toContain('const initialState = serializeForInlineScript(payload)');
    expect(source).toContain('let state=${initialState}');
    expect(source).toContain('const initialMarkup = initialWatchlistMarkup(payload.groups, payload.entries)');
    expect(source).toContain('<div id="app">${initialMarkup}</div>');
    expect(source).not.toContain('let state={groups:[],entries:[]');
    expect(source.indexOf('renderSafely();vscode.postMessage')).toBeGreaterThan(-1);
  });

  it('builds escaped static markup so the list is visible before scripts run', () => {
    const source = readFileSync(resolve('src/views/watchlist-webview.ts'), 'utf8');
    expect(source).toContain('function initialWatchlistMarkup(');
    expect(source).toContain('function escapeHtml(');
    expect(source).toContain('escapeHtml(entry.name)');
    expect(source).toContain('escapeHtml(group.name)');
  });

  it('shows page-level rendering errors inside the webview', () => {
    const source = readFileSync(resolve('src/views/watchlist-webview.ts'), 'utf8');
    expect(source).toContain("window.addEventListener('error'");
    expect(source).toContain("window.addEventListener('unhandledrejection'");
    expect(source).toContain("showError('自选股渲染失败：'");
  });

  it('uses the VS Code webview CSP source and a cryptographic nonce', () => {
    const source = readFileSync(resolve('src/views/watchlist-webview.ts'), 'utf8');
    expect(source).toContain("import { randomBytes } from 'node:crypto'");
    expect(source).toContain("randomBytes(16).toString('base64')");
    expect(source).toContain('style-src ${webview.cspSource}');
    expect(source).toContain('script-src ${webview.cspSource}');
  });
});
