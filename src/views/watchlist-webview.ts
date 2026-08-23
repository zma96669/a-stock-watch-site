import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { MarketSnapshot, StockRef, WatchlistEntry, WatchlistGroup } from '../domain/types';
import { searchStocks } from '../market/stock-search';
import type { CurrentStockStore } from '../state/current-stock-store';
import type { WatchlistStore } from '../state/watchlist-store';
import type { QuoteService } from '../services/quote-service';
import { serializeForInlineScript } from './inline-script';

interface WatchlistMessage {
  type: string;
  code?: string;
  query?: string;
  groupId?: string;
  name?: string;
  costPrice?: unknown;
  shares?: unknown;
}

export class WatchlistWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private readonly subscriptions: vscode.Disposable[] = [];
  private snapshot: MarketSnapshot = { quotes: {}, intraday: [], stale: false };
  private searchResults = new Map<string, StockRef>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly watchlist: WatchlistStore,
    private readonly current: CurrentStockStore,
    private readonly quotes: QuoteService
  ) {
    this.subscriptions.push(
      watchlist.onDidChange(() => this.postState()),
      current.onDidChange(() => this.postState()),
      { dispose: quotes.subscribe((snapshot) => { this.snapshot = snapshot; this.postState(); }) }
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.onDidReceiveMessage((message: WatchlistMessage) => { void this.handle(message); }, undefined, this.subscriptions);
    view.onDidDispose(() => { if (this.view === view) this.view = undefined; }, undefined, this.subscriptions);
    view.webview.html = this.html(view.webview);
    this.postState();
  }

  showSearch(): void {
    this.view?.show?.(true);
    void this.view?.webview.postMessage({ type: 'focusSearch' });
  }

  dispose(): void {
    this.subscriptions.splice(0).forEach((subscription) => subscription.dispose());
  }

  private postState(): void {
    void this.view?.webview.postMessage({
      type: 'state',
      payload: this.statePayload()
    });
  }

  private statePayload() {
    return {
      groups: this.watchlist.getGroups(),
      entries: this.watchlist.getEntries(),
      currentCode: this.current.get(),
      snapshot: this.snapshot
    };
  }

  private async handle(message: WatchlistMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          this.postState();
          break;
        case 'select':
          if (message.code) await this.current.set(message.code);
          break;
        case 'search':
          await this.search(message.query ?? '');
          break;
        case 'addSearch':
          await this.addSearch(message.code, message.groupId);
          break;
        case 'remove':
          if (message.code) await this.watchlist.remove(message.code);
          break;
        case 'createGroup':
          await this.watchlist.addGroup(message.name ?? '新分组');
          break;
        case 'renameGroup':
          if (message.groupId) await this.watchlist.renameGroup(message.groupId, message.name ?? '');
          break;
        case 'toggleGroup':
          if (message.groupId) await this.watchlist.toggleGroup(message.groupId);
          break;
        case 'holding':
          if (message.code) await this.watchlist.updateHolding(message.code, numberOrUndefined(message.costPrice), numberOrUndefined(message.shares));
          break;
        case 'move':
          if (message.code && message.groupId) await this.watchlist.move(message.code, message.groupId);
          break;
      }
    } catch (error) {
      void this.view?.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async search(query: string): Promise<void> {
    const rows = await searchStocks(query);
    this.searchResults = new Map(rows.map((stock) => [stock.code, stock]));
    void this.view?.webview.postMessage({ type: 'searchResults', rows });
  }

  private async addSearch(code: string | undefined, groupId: string | undefined): Promise<void> {
    if (!code) return;
    const stock = this.searchResults.get(code);
    if (!stock) throw new Error('搜索结果已过期，请重新搜索');
    const added = await this.watchlist.add(stock, groupId);
    if (!added) throw new Error(`${stock.name}（${stock.code}）已经在自选股中`);
    if (!this.current.get()) await this.current.set(stock.code);
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';`;
    const payload = this.statePayload();
    const initialState = serializeForInlineScript(payload);
    const initialMarkup = initialWatchlistMarkup(payload.groups, payload.entries);
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;padding:8px;color:var(--vscode-foreground);font:12px var(--vscode-font-family);background:var(--vscode-sideBar-background)}button,input,select{font:inherit;color:inherit;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:3px;padding:4px 6px}button{cursor:pointer}button:hover{background:var(--vscode-list-hoverBackground)}.toolbar{display:flex;gap:4px;margin-bottom:7px}.toolbar input{min-width:0;flex:1}.group{margin:7px 0;border:1px solid var(--vscode-tree-indentGuidesStroke);border-radius:4px;overflow:hidden}.group-head{display:flex;align-items:center;gap:5px;padding:6px;background:var(--vscode-list-inactiveSelectionBackground);cursor:pointer}.group-name{font-weight:600;flex:1}.group-meta{opacity:.7;font-size:11px}.group-actions{display:flex;gap:2px}.group-actions button{padding:1px 4px;border:0;background:transparent}.stock{padding:6px 7px;border-top:1px solid color-mix(in srgb,var(--vscode-sideBar-border) 60%,transparent);cursor:pointer}.stock:hover{background:var(--vscode-list-hoverBackground)}.stock.current{background:var(--vscode-list-activeSelectionBackground)}.stock-main,.stock-sub{display:flex;align-items:center;gap:6px}.stock-main .name{font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.code{opacity:.58;font-size:11px}.price{text-align:right;min-width:56px}.pct{text-align:right;min-width:50px}.up{color:var(--vscode-charts-red)}.down{color:var(--vscode-charts-green)}.stock-sub{margin-top:4px;opacity:.72;font-size:11px;gap:9px}.holding{padding:9px 7px}.holding .stock-sub{opacity:.9}.result{display:flex;align-items:center;gap:5px;padding:5px;border-top:1px solid var(--vscode-tree-indentGuidesStroke)}.result span:first-child{flex:1}.results{margin-bottom:7px}.empty,.error{padding:8px;opacity:.7}.error{color:var(--vscode-editorWarning-foreground)}.hidden{display:none}
</style></head><body><div class="toolbar"><input id="search" placeholder="输入股票名称或代码"><button id="searchBtn">搜索</button><button id="groupBtn">分组</button></div><div id="results" class="results"></div><div id="app">${initialMarkup}</div><div id="error" class="error hidden"></div>
<script nonce="${nonce}">
(() => { const vscode=acquireVsCodeApi(); let state=${initialState}; const $=s=>document.querySelector(s); const search=$('#search');
function errorText(value){return value instanceof Error?value.message:String(value??'未知错误')}function showError(message){const el=$('#error');if(!el)return;el.textContent=message;el.classList.remove('hidden')}function renderSafely(){try{render()}catch(error){showError('自选股渲染失败：'+errorText(error))}}
window.addEventListener('error',event=>showError('自选股页面错误：'+errorText(event.error||event.message)));window.addEventListener('unhandledrejection',event=>showError('自选股页面错误：'+errorText(event.reason)));
$('#searchBtn').onclick=()=>vscode.postMessage({type:'search',query:search.value}); search.onkeydown=e=>{if(e.key==='Enter')$('#searchBtn').click()}; $('#groupBtn').onclick=()=>{const name=prompt('分组名称','新分组');if(name)vscode.postMessage({type:'createGroup',name})};
window.addEventListener('message',e=>{const m=e.data||{};if(m.type==='state'){state=m.payload;renderSafely()}if(m.type==='searchResults')renderResults(m.rows||[]);if(m.type==='error')showError(m.message);if(m.type==='focusSearch')search.focus()});
function render(){const app=$('#app');app.textContent=''; if(!state.entries.length){app.innerHTML='<div class="empty">暂无自选股，搜索名称或代码后添加</div>';return} const groups=state.groups.slice().sort((a,b)=>a.sortOrder-b.sortOrder); groups.forEach(g=>{const wrap=document.createElement('section');wrap.className='group';const head=document.createElement('div');head.className='group-head';head.onclick=()=>vscode.postMessage({type:'toggleGroup',groupId:g.id});const entries=state.entries.filter(x=>x.groupId===g.id);const groupPct=groupChange(entries);head.innerHTML='<span>'+ (g.collapsed?'▶':'▼') +'</span><span class="group-name"></span><span class="group-meta"></span><span class="group-actions"><button title="重命名">✎</button></span>';head.querySelector('.group-name').textContent=g.name;const meta=head.querySelector('.group-meta');meta.textContent=entries.length+'只 '+fmtPct(groupPct);setTone(meta,groupPct);head.querySelector('.group-actions button').onclick=e=>{e.stopPropagation();const name=prompt('分组名称',g.name);if(name)vscode.postMessage({type:'renameGroup',groupId:g.id,name})};wrap.appendChild(head);if(!g.collapsed)entries.forEach(entry=>wrap.appendChild(stockCard(entry)));app.appendChild(wrap)});}
function stockCard(entry){const quote=state.snapshot.quotes[entry.code];const price=quote&&quote.price;const pct=quote&&quote.changePercent;const holding=Number(entry.shares)>0&&Number(entry.costPrice)>0;const el=document.createElement('div');el.className='stock '+(entry.code===state.currentCode?'current ':'')+(holding?'holding':'');el.onclick=()=>vscode.postMessage({type:'select',code:entry.code});const profit=holding&&price!=null?(price-entry.costPrice)*entry.shares:void 0;const profitPct=holding&&price!=null?(price-entry.costPrice)/entry.costPrice*100:void 0;el.innerHTML='<div class="stock-main"><span class="name"></span><span class="code"></span><span class="price"></span><span class="pct"></span></div>'+(holding?'<div class="stock-sub"><span class="holding-cost"></span><span class="holding-shares"></span><span class="holding-profit"></span><span class="holding-pct"></span><select class="group-select"></select><button class="edit">持仓</button><button class="remove">删</button></div>':'<div class="stock-sub"><span class="amount"></span><select class="group-select"></select><button class="edit">持仓</button><button class="remove">删</button></div>');el.querySelector('.name').textContent=quote?.name||entry.name;el.querySelector('.code').textContent=entry.code;el.querySelector('.price').textContent=fmt(price);setTone(el.querySelector('.price'),pct);el.querySelector('.pct').textContent=fmtPct(pct);setTone(el.querySelector('.pct'),pct);if(holding){el.querySelector('.holding-cost').textContent='成本 '+fmt(entry.costPrice);el.querySelector('.holding-shares').textContent='股数 '+entry.shares;el.querySelector('.holding-profit').textContent='盈亏 '+fmtMoney(profit);el.querySelector('.holding-pct').textContent=fmtPct(profitPct);setTone(el.querySelector('.holding-profit'),profit);setTone(el.querySelector('.holding-pct'),profitPct)}else el.querySelector('.amount').textContent='额 '+fmtMoney(quote?.amount);const groupSelect=el.querySelector('.group-select');state.groups.slice().sort((a,b)=>a.sortOrder-b.sortOrder).forEach(g=>{const o=document.createElement('option');o.value=g.id;o.textContent=g.name;o.selected=g.id===entry.groupId;groupSelect.appendChild(o)});groupSelect.onchange=e=>{e.stopPropagation();vscode.postMessage({type:'move',code:entry.code,groupId:groupSelect.value)};groupSelect.onclick=e=>e.stopPropagation();el.querySelector('.edit').onclick=e=>{e.stopPropagation();editHolding(entry)};el.querySelector('.remove').onclick=e=>{e.stopPropagation();if(confirm('从自选股移除 '+entry.name+'？'))vscode.postMessage({type:'remove',code:entry.code})};return el}
function editHolding(entry){const cost=prompt('成本价（留空清除持仓）',entry.costPrice??'');if(cost===null)return;const shares=cost.trim()?prompt('持仓股数',entry.shares??''):'';vscode.postMessage({type:'holding',code:entry.code,costPrice:cost,shares})}
function renderResults(rows){const box=$('#results');box.textContent='';if(!rows.length){box.innerHTML='<div class="empty">未找到沪深 A 股</div>';return}rows.forEach(row=>{const el=document.createElement('div');el.className='result';const span=document.createElement('span');span.textContent=row.name+' '+row.code;const select=document.createElement('select');state.groups.forEach(g=>{const o=document.createElement('option');o.value=g.id;o.textContent=g.name;select.appendChild(o)});const btn=document.createElement('button');btn.textContent='添加';btn.onclick=()=>vscode.postMessage({type:'addSearch',code:row.code,groupId:select.value});el.append(span,select,btn);box.appendChild(el)})}
function groupChange(entries){let change=0,base=0;entries.forEach(e=>{const q=state.snapshot.quotes[e.code];if(q?.price!=null&&q.previousClose!=null){change+=q.price-q.previousClose;base+=q.previousClose}});return base?change/base*100:void 0}
function fmt(v){return v==null||!Number.isFinite(Number(v))?'--':Number(v).toFixed(2)}function fmtPct(v){return v==null||!Number.isFinite(Number(v))?'--':(Number(v)>=0?'+':'')+Number(v).toFixed(2)+'%'}function fmtMoney(v){if(v==null||!Number.isFinite(Number(v)))return'--';const n=Number(v);return(n>=0?'+':'')+(Math.abs(n)>=1e4?(n/1e4).toFixed(2)+'万':n.toFixed(2))}function setTone(el,v){if(!el)return;el.classList.toggle('up',Number(v)>0);el.classList.toggle('down',Number(v)<0)}
renderSafely();vscode.postMessage({type:'ready'});
})();
</script></body></html>`;
  }
}

function initialWatchlistMarkup(groups: readonly WatchlistGroup[], entries: readonly WatchlistEntry[]): string {
  if (!entries.length) return '<div class="empty">暂无自选股，搜索名称或代码后添加</div>';
  return groups.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((group) => {
    const groupEntries = entries.filter((entry) => entry.groupId === group.id);
    const stocks = group.collapsed ? '' : groupEntries.map((entry) => `<div class="stock"><div class="stock-main"><span class="name">${escapeHtml(entry.name)}</span><span class="code">${escapeHtml(entry.code)}</span><span class="price">--</span><span class="pct">--</span></div></div>`).join('');
    return `<section class="group"><div class="group-head"><span>${group.collapsed ? '▶' : '▼'}</span><span class="group-name">${escapeHtml(group.name)}</span><span class="group-meta">${groupEntries.length}只 --</span></div>${stocks}</section>`;
  }).join('');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
