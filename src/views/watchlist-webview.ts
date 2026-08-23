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
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;padding:8px;color:var(--vscode-foreground);font:12px var(--vscode-font-family);background:var(--vscode-sideBar-background)}button,input,select{font:inherit;color:inherit;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:3px;padding:4px 6px}button{cursor:pointer}button:hover{background:var(--vscode-list-hoverBackground)}.toolbar{display:flex;gap:4px;margin-bottom:7px}.toolbar input{min-width:0;flex:1}.group{margin:7px 0;border:1px solid var(--vscode-tree-indentGuidesStroke);border-radius:4px;overflow:visible}.group-head{display:flex;align-items:center;gap:5px;padding:6px;background:var(--vscode-list-inactiveSelectionBackground);cursor:pointer}.group-name{font-weight:600;flex:1}.group-meta{opacity:.7;font-size:11px}.group-actions{display:flex;gap:2px}.group-actions button{padding:1px 4px;border:0;background:transparent}.stock{padding:6px 7px;border-top:1px solid color-mix(in srgb,var(--vscode-sideBar-border) 60%,transparent);cursor:pointer;min-height:30px}.stock:hover{background:var(--vscode-list-hoverBackground)}.stock.current{background:var(--vscode-list-activeSelectionBackground)}.stock-main{display:flex;align-items:center;gap:7px;min-width:0}.stock-main .name{font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.price{text-align:right;min-width:48px}.pct{text-align:right;min-width:48px}.up{color:var(--vscode-charts-red)}.down{color:var(--vscode-charts-green)}.stock-menu{position:relative;flex:0 0 18px}.stock-menu summary{list-style:none;cursor:pointer;text-align:center;opacity:.5;font-weight:700}.stock-menu summary::-webkit-details-marker{display:none}.stock-menu[open] summary,.stock-menu summary:hover{opacity:1}.stock-menu-panel{position:absolute;z-index:20;right:-3px;top:20px;width:132px;padding:5px;display:grid;gap:4px;background:var(--vscode-menu-background,var(--vscode-sideBar-background));border:1px solid var(--vscode-menu-border,var(--vscode-sideBar-border));border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,.35)}.stock-menu-panel select,.stock-menu-panel button{width:100%;text-align:left}.holding .name::after{content:'·';margin-left:3px;color:var(--vscode-charts-yellow);opacity:.7}.result{display:flex;align-items:center;gap:5px;padding:5px;border-top:1px solid var(--vscode-tree-indentGuidesStroke)}.result span:first-child{flex:1}.results{margin-bottom:7px}.empty,.error{padding:8px;opacity:.7}.error{color:var(--vscode-editorWarning-foreground)}.modal{position:fixed;z-index:100;inset:0;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(0,0,0,.48)}.modal-card{width:min(280px,100%);padding:10px;background:var(--vscode-editorWidget-background,var(--vscode-sideBar-background));border:1px solid var(--vscode-widget-border,var(--vscode-sideBar-border));border-radius:5px;box-shadow:0 8px 24px rgba(0,0,0,.45)}.modal-title{font-weight:600;margin-bottom:9px}.modal-fields{display:grid;gap:8px}.modal-field{display:grid;gap:4px}.modal-field span{opacity:.72}.modal-field input{width:100%}.modal-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:11px}.danger{color:var(--vscode-errorForeground)}.hidden{display:none}
</style></head><body><div class="toolbar"><input id="search" placeholder="输入股票名称或代码"><button id="searchBtn">搜索</button><button id="groupBtn">分组</button></div><div id="results" class="results"></div><div id="app">${initialMarkup}</div><div id="error" class="error hidden"></div><div id="modal" class="modal hidden"><div class="modal-card" role="dialog" aria-modal="true"><div id="modalTitle" class="modal-title"></div><div id="modalFields" class="modal-fields"></div><div class="modal-actions"><button id="modalCancel">取消</button><button id="modalConfirm">确定</button></div></div></div>
<script nonce="${nonce}">
(() => { const vscode=acquireVsCodeApi(); let state=${initialState}; let structureKey=''; let modalAction; const $=s=>document.querySelector(s); const search=$('#search');
function errorText(value){return value instanceof Error?value.message:String(value??'未知错误')}function showError(message){const el=$('#error');if(!el)return;el.textContent=message;el.classList.remove('hidden')}function renderSafely(){try{render()}catch(error){showError('自选股渲染失败：'+errorText(error))}}function updateDynamicSafely(){try{updateDynamic()}catch(error){showError('行情更新失败：'+errorText(error))}}
window.addEventListener('error',event=>showError('自选股页面错误：'+errorText(event.error||event.message)));window.addEventListener('unhandledrejection',event=>showError('自选股页面错误：'+errorText(event.reason)));
$('#searchBtn').onclick=()=>vscode.postMessage({type:'search',query:search.value});search.onkeydown=e=>{if(e.key==='Enter')$('#searchBtn').click()};$('#groupBtn').onclick=()=>openDialog({title:'新建分组',fields:[{name:'name',label:'分组名称',value:'新分组'}],submit:v=>{if(v.name.trim())vscode.postMessage({type:'createGroup',name:v.name})}});
window.addEventListener('message',e=>{const m=e.data||{};if(m.type==='state'){const next=m.payload;const changed=structureSignature(next)!==structureKey;state=next;if(changed)renderSafely();else updateDynamicSafely()}if(m.type==='searchResults')renderResults(m.rows||[]);if(m.type==='error')showError(m.message);if(m.type==='focusSearch')search.focus()});
function structureSignature(value){return JSON.stringify({groups:value.groups.map(g=>[g.id,g.name,g.sortOrder,g.collapsed]),entries:value.entries.map(e=>[e.code,e.name,e.groupId,e.sortOrder,e.costPrice,e.shares])})}
function render(){structureKey=structureSignature(state);const app=$('#app');app.textContent='';if(!state.entries.length){app.innerHTML='<div class="empty">暂无自选股，搜索名称或代码后添加</div>';return}const groups=state.groups.slice().sort((a,b)=>a.sortOrder-b.sortOrder);groups.forEach(g=>{const wrap=document.createElement('section');wrap.className='group';wrap.dataset.groupId=g.id;const head=document.createElement('div');head.className='group-head';head.onclick=()=>vscode.postMessage({type:'toggleGroup',groupId:g.id});const entries=state.entries.filter(x=>x.groupId===g.id);head.innerHTML='<span>'+ (g.collapsed?'▶':'▼') +'</span><span class="group-name"></span><span class="group-meta"></span><span class="group-actions"><button title="重命名">✎</button></span>';head.querySelector('.group-name').textContent=g.name;head.querySelector('.group-actions button').onclick=e=>{e.stopPropagation();openDialog({title:'重命名分组',fields:[{name:'name',label:'分组名称',value:g.name}],submit:v=>{if(v.name.trim())vscode.postMessage({type:'renameGroup',groupId:g.id,name:v.name})}})};wrap.appendChild(head);if(!g.collapsed)entries.forEach(entry=>wrap.appendChild(stockCard(entry)));app.appendChild(wrap)});updateDynamic()}
function stockCard(entry){const el=document.createElement('div');el.className='stock';el.dataset.code=entry.code;el.onclick=()=>vscode.postMessage({type:'select',code:entry.code});el.innerHTML='<div class="stock-main"><span class="name"></span><span class="price"></span><span class="pct"></span><details class="stock-menu"><summary title="更多操作">···</summary><div class="stock-menu-panel"><select class="group-select" title="移动到分组"></select><button class="edit">设置持仓</button><button class="remove">删除股票</button></div></details></div>';const menu=el.querySelector('.stock-menu');menu.onclick=e=>e.stopPropagation();menu.ontoggle=()=>{if(menu.open)document.querySelectorAll('.stock-menu[open]').forEach(other=>{if(other!==menu)other.removeAttribute('open')})};const groupSelect=el.querySelector('.group-select');state.groups.slice().sort((a,b)=>a.sortOrder-b.sortOrder).forEach(g=>{const o=document.createElement('option');o.value=g.id;o.textContent=g.name;o.selected=g.id===entry.groupId;groupSelect.appendChild(o)});groupSelect.onchange=e=>{e.stopPropagation();vscode.postMessage({type:'move',code:entry.code,groupId:groupSelect.value});menu.removeAttribute('open')};el.querySelector('.edit').onclick=e=>{e.stopPropagation();menu.removeAttribute('open');editHolding(entry)};el.querySelector('.remove').onclick=e=>{e.stopPropagation();menu.removeAttribute('open');openDialog({title:'删除 '+entry.name+'？',confirmLabel:'删除',danger:true,submit:()=>vscode.postMessage({type:'remove',code:entry.code})})};return el}
function updateDynamic(){document.querySelectorAll('.group[data-group-id]').forEach(section=>{const group=state.groups.find(g=>g.id===section.dataset.groupId);if(!group)return;const entries=state.entries.filter(e=>e.groupId===group.id);const pct=groupChange(entries);const meta=section.querySelector('.group-meta');meta.textContent=entries.length+'只 '+fmtPct(pct);setTone(meta,pct)});document.querySelectorAll('.stock[data-code]').forEach(el=>{const entry=state.entries.find(e=>e.code===el.dataset.code);if(entry)updateStockRow(el,entry)})}
function updateStockRow(el,entry){const quote=state.snapshot.quotes[entry.code];const price=quote&&quote.price;const pct=quote&&quote.changePercent;const holding=Number(entry.shares)>0&&Number(entry.costPrice)>0;const profit=holding&&price!=null?(price-entry.costPrice)*entry.shares:void 0;const profitPct=holding&&price!=null?(price-entry.costPrice)/entry.costPrice*100:void 0;el.classList.toggle('current',entry.code===state.currentCode);el.classList.toggle('holding',holding);el.querySelector('.name').textContent=quote?.name||entry.name;el.querySelector('.price').textContent=fmt(price);setTone(el.querySelector('.price'),pct);el.querySelector('.pct').textContent=fmtPct(pct);setTone(el.querySelector('.pct'),pct);const tips=[quote?.name||entry.name,'最新 '+fmt(price)+'  涨跌 '+fmtPct(pct),'成交额 '+fmtMoney(quote?.amount)];if(holding){tips.push('成本 '+fmt(entry.costPrice)+'  股数 '+entry.shares);tips.push('持仓盈亏 '+fmtMoney(profit)+'  '+fmtPct(profitPct))}el.title=tips.join('\\n')}
function editHolding(entry){openDialog({title:'设置 '+entry.name+' 持仓',fields:[{name:'costPrice',label:'成本价（留空清除持仓）',value:entry.costPrice??'',type:'number'},{name:'shares',label:'持仓股数',value:entry.shares??'',type:'number'}],submit:v=>vscode.postMessage({type:'holding',code:entry.code,costPrice:v.costPrice,shares:v.costPrice.trim()?v.shares:''})})}
function openDialog(options){const modal=$('#modal');const fields=$('#modalFields');$('#modalTitle').textContent=options.title;fields.textContent='';(options.fields||[]).forEach(field=>{const label=document.createElement('label');label.className='modal-field';const text=document.createElement('span');text.textContent=field.label;const input=document.createElement('input');input.name=field.name;input.type=field.type||'text';input.value=String(field.value??'');if(input.type==='number'){input.min='0';input.step='any'}label.append(text,input);fields.appendChild(label)});const confirm=$('#modalConfirm');confirm.textContent=options.confirmLabel||'确定';confirm.classList.toggle('danger',Boolean(options.danger));modalAction=()=>{const values={};fields.querySelectorAll('input').forEach(input=>values[input.name]=input.value);options.submit(values);closeDialog()};modal.classList.remove('hidden');setTimeout(()=>fields.querySelector('input')?.focus(),0)}
function closeDialog(){$('#modal').classList.add('hidden');modalAction=void 0}$('#modalConfirm').onclick=()=>modalAction?.();$('#modalCancel').onclick=closeDialog;$('#modal').onclick=e=>{if(e.target===$('#modal'))closeDialog()};window.addEventListener('keydown',e=>{if(!$('#modal').classList.contains('hidden')){if(e.key==='Escape')closeDialog();if(e.key==='Enter')modalAction?.()}});
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
    const stocks = group.collapsed ? '' : groupEntries.map((entry) => `<div class="stock"><div class="stock-main"><span class="name">${escapeHtml(entry.name)}</span><span class="price">--</span><span class="pct">--</span></div></div>`).join('');
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
