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

  it('renders stocks as one compact row with secondary actions in a menu', () => {
    const source = readFileSync(resolve('src/views/watchlist-webview.ts'), 'utf8');
    expect(source).toContain('<details class="stock-menu">');
    expect(source).toContain('<div class="stock-menu-panel">');
    expect(source).toContain("el.title=tips.join('\\\\n')");
    expect(source).not.toContain('<div class="stock-sub">');
    expect(source).not.toContain('<span class="code">');
  });

  it('updates live prices without rebuilding the list structure', () => {
    const source = readFileSync(resolve('src/views/watchlist-webview.ts'), 'utf8');
    expect(source).toContain('const changed=structureSignature(next)!==structureKey');
    expect(source).toContain('if(changed)renderSafely();else updateDynamicSafely()');
    expect(source).toContain('function updateDynamic()');
    expect(source).toContain("el.dataset.code=entry.code");
  });

  it('uses an in-webview dialog for group and holding operations', () => {
    const source = readFileSync(resolve('src/views/watchlist-webview.ts'), 'utf8');
    expect(source).toContain('function openDialog(options)');
    expect(source).toContain("title:'新建分组'");
    expect(source).toContain("title:'重命名分组'");
    expect(source).toContain("title:'设置 '+entry.name+' 持仓'");
    expect(source).not.toContain("prompt('");
    expect(source).not.toContain("confirm('");
    expect(source).toContain("value:'',placeholder:'例如：银行'");
    expect(source).toContain("if(!v.name.trim())return false");
  });

  it('pins holdings in a separate top tree node and removes color tones', () => {
    const source = readFileSync(resolve('src/views/watchlist-webview.ts'), 'utf8');
    expect(source).toContain("groupSection('持仓','__holdings__'");
    expect(source).toContain("wrap.className='group'+(isHoldings?' holdings-group':'')");
    expect(source).toContain('&&!isHoldingEntry(x)');
    expect(source).toContain('function isHoldingEntry(entry)');
    expect(source).toContain('function setTone(el,v){void el;void v}');
    expect(source).not.toContain('var(--vscode-charts-red)');
    expect(source).not.toContain('var(--vscode-charts-green)');
  });

  it('dismisses stock menus after leaving or interacting elsewhere', () => {
    const source = readFileSync(resolve('src/views/watchlist-webview.ts'), 'utf8');
    expect(source).toContain('menu.onmouseenter=cancelMenuClose');
    expect(source).toContain('menu.onmouseleave=()=>scheduleMenuClose(menu)');
    expect(source).toContain('setTimeout(()=>');
    expect(source).toContain('},250)');
    expect(source).toContain("document.addEventListener('pointerdown'");
    expect(source).toContain("document.addEventListener('wheel'");
    expect(source).toContain("window.addEventListener('blur'");
    expect(source).toContain("document.addEventListener('visibilitychange'");
  });

  it('supports persistent drag sorting outside the fixed holdings tree', () => {
    const source = readFileSync(resolve('src/views/watchlist-webview.ts'), 'utf8');
    expect(source).toContain("case 'reorderGroup':");
    expect(source).toContain("case 'placeStock':");
    expect(source).toContain('if(!isHoldings&&!isFollowed)enableGroupDrag(head,id)');
    expect(source).toContain('stockCard(entry,!isHoldings&&!isFollowed)');
    expect(source).toContain("type:'reorderGroup'");
    expect(source).toContain("type:'placeStock'");
    expect(source).toContain("event.target.closest('.stock-menu')");
    expect(source).toContain('.drop-before');
    expect(source).toContain('.drop-after');
  });

  it('renders 我的关注 as a duplicate view and offers follow toggles', () => {
    const source = readFileSync(resolve('src/views/watchlist-webview.ts'), 'utf8');
    expect(source).toContain("state.entries.filter(x=>x.followed)");
    expect(source).toContain("filter(g=>g.id!=='${DEFAULT_GROUP_ID}')");
    expect(source).toContain("follow.textContent=entry.followed?'取消关注':'关注'");
    expect(source).toContain("case 'follow':");
    expect(source).toContain("case 'unfollow':");
  });

  it('uses an Explorer-like workbench tree with aligned chevrons and indent guides', () => {
    const source = readFileSync(resolve('src/views/watchlist-webview.ts'), 'utf8');
    expect(source).toContain('#app{--tree-column:18px}');
    expect(source).toContain('.tree-arrow::before');
    expect(source).toContain('.tree-arrow.expanded::before');
    expect(source).toContain('var(--vscode-tree-indentGuidesStroke');
    expect(source).toContain("children.className='group-children'");
    expect(source).toContain('<div class="group-children">');
    expect(source).toContain("head.setAttribute('aria-expanded',String(!collapsed))");
    expect(source).not.toContain("(collapsed?'▶':'▼')");
  });
});
