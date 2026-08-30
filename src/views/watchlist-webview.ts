import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { AlertRule, AlertSeverity, AlertRuleType, MarketSnapshot, PortfolioData, StockRef, WatchlistEntry, WatchlistGroup } from '../domain/types';
import { MARKET_INDICES } from '../market/market-indices';
import { searchStocks } from '../market/stock-search';
import type { CurrentStockStore } from '../state/current-stock-store';
import { DEFAULT_GROUP_ID, type WatchlistStore } from '../state/watchlist-store';
import type { QuoteService } from '../services/quote-service';
import type { AlertStore } from '../state/alert-store';
import type { PortfolioStore } from '../state/portfolio-store';
import { serializeForInlineScript } from './inline-script';

interface WatchlistMessage {
  type: string;
  code?: string;
  query?: string;
  groupId?: string;
  name?: string;
  costPrice?: unknown;
  shares?: unknown;
  targetGroupId?: string;
  targetCode?: string;
  position?: 'before' | 'after';
  ruleType?: AlertRuleType;
  ruleId?: string;
  threshold?: unknown;
  severity?: AlertSeverity;
  enabled?: boolean;
  price?: unknown;
  note?: string;
  clearedId?: string;
  positionId?: string;
}

export class WatchlistWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private readonly subscriptions: vscode.Disposable[] = [];
  private snapshot: MarketSnapshot = { quotes: {}, indexQuotes: {}, indexIntraday: {}, intraday: [], stale: false };
  private searchResults = new Map<string, StockRef>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly watchlist: WatchlistStore,
    private readonly current: CurrentStockStore,
    private readonly quotes: QuoteService,
    private readonly alerts?: AlertStore,
    private readonly portfolio?: PortfolioStore
  ) {
    this.subscriptions.push(
      watchlist.onDidChange(() => this.postState()),
      current.onDidChange(() => this.postState()),
      ...(alerts ? [alerts.onDidChange(() => this.postState())] : []),
      ...(portfolio ? [portfolio.onDidChange(() => this.postState())] : []),
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
    const entries = this.watchlist.getEntries().map((entry) => {
      const position = this.portfolio?.getPosition(entry.code);
      return position ? { ...entry, costPrice: position.averageCost, shares: position.shares } : entry;
    });
    return {
      groups: this.watchlist.getGroups(),
      entries,
      indices: MARKET_INDICES,
      currentCode: this.current.get(),
      snapshot: this.snapshot,
      alerts: {
        rules: this.alerts?.getRules() ?? [],
        events: this.alerts?.getEvents() ?? []
      },
      portfolio: this.portfolio?.getData() ?? emptyPortfolio()
    };
  }

  private async handle(message: WatchlistMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          this.postState();
          break;
        case 'select':
          if (message.code) {
            await this.current.set(message.code);
            this.quotes.selectStock();
          }
          break;
        case 'selectIndex':
          if (message.code) this.quotes.selectIndex(message.code);
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
          await this.watchlist.addGroup(message.name ?? '');
          break;
        case 'renameGroup':
          if (message.groupId) await this.watchlist.renameGroup(message.groupId, message.name ?? '');
          break;
        case 'toggleGroup':
          if (message.groupId) await this.watchlist.toggleGroup(message.groupId);
          break;
        case 'holding':
          if (message.code) {
            const entry = this.watchlist.getEntry(message.code);
            if (this.portfolio && entry) await this.portfolio.setManualPosition(message.code, entry.name, numberOrUndefined(message.costPrice), numberOrUndefined(message.shares));
            else await this.watchlist.updateHolding(message.code, numberOrUndefined(message.costPrice), numberOrUndefined(message.shares));
          }
          break;
        case 'buy':
          if (this.portfolio && message.code) {
            const entry = this.watchlist.getEntry(message.code);
            if (entry) await this.portfolio.buy(message.code, entry.name, numberOrUndefined(message.price) ?? 0, integerOrUndefined(message.shares) ?? 0, message.note);
          }
          break;
        case 'sell':
          if (this.portfolio && message.code) {
            const entry = this.watchlist.getEntry(message.code);
            if (entry) await this.portfolio.sell(message.code, entry.name, numberOrUndefined(message.price) ?? 0, integerOrUndefined(message.shares) ?? 0, message.note);
          }
          break;
        case 'deleteCleared':
          if (this.portfolio && message.clearedId) await this.portfolio.deleteCleared(message.clearedId);
          break;
        case 'trades':
          if (this.portfolio) {
            const rows = message.clearedId
              ? this.portfolio.getCleared().find((item) => item.id === message.clearedId)?.trades ?? []
              : message.positionId ? this.portfolio.getTrades(message.positionId) : [];
            if (rows.length) void vscode.window.showInformationMessage(rows.map((trade) => `${trade.side === 'buy' ? '买入' : '卖出'} ${trade.shares}股 @ ${trade.price.toFixed(2)}（${new Date(trade.tradedAt).toLocaleString('zh-CN')}）`).join('\n'));
            else void vscode.window.showInformationMessage('这只股票还没有交易流水');
          }
          break;
        case 'follow':
          if (message.code) await this.watchlist.setFollowed(message.code, true);
          break;
        case 'unfollow':
          if (message.code) await this.watchlist.setFollowed(message.code, false);
          break;
        case 'move':
          if (message.code && message.groupId) await this.watchlist.move(message.code, message.groupId);
          break;
        case 'reorderGroup':
          if (message.groupId && message.targetGroupId && message.position) await this.watchlist.reorderGroup(message.groupId, message.targetGroupId, message.position);
          break;
        case 'placeStock':
          if (message.code && message.targetGroupId) await this.watchlist.placeStock(message.code, message.targetGroupId, message.targetCode, message.position);
          break;
        case 'alertCreate':
          if (!this.alerts || !message.code || !message.ruleType) break;
          await this.alerts.create({ code: message.code, type: message.ruleType, threshold: numberOrUndefined(message.threshold) ?? 0, severity: message.severity });
          break;
        case 'alertToggle':
          if (this.alerts && message.ruleId) await this.alerts.toggle(message.ruleId);
          break;
        case 'alertRemove':
          if (this.alerts && message.ruleId) await this.alerts.remove(message.ruleId);
          break;
        case 'alertRead':
          if (this.alerts) await this.alerts.markRead(message.ruleId);
          break;
        case 'alertMute':
          if (this.alerts && message.ruleId) await this.alerts.muteToday(message.ruleId);
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
    const initialMarkup = initialWatchlistMarkup(payload.indices, payload.groups, payload.entries);
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
 <style>
body{height:100vh;overflow:hidden;display:flex;flex-direction:column}.toolbar,.results{flex:0 0 auto}.results{max-height:28vh;overflow-y:auto}#app{display:flex;flex:1;min-height:0;overflow:hidden;flex-direction:column}.market-overview,.alert-center,.holdings-group{position:relative!important;top:auto!important;flex:0 0 auto}.market-overview{z-index:1}.alert-center{z-index:1}.holdings-group{max-height:30vh;overflow:hidden;display:flex;flex-direction:column}.holdings-group .group-head{flex:0 0 auto}.holdings-group .group-children{min-height:0;overflow-y:auto;overflow-x:hidden}.stock-list-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden}.stock-list-scroll>.group{flex:0 0 auto}.cleared-group{margin-top:4px;padding-top:2px;border-top:1px solid var(--vscode-tree-indentGuidesStroke,rgba(128,128,128,.2))}.cleared-row{min-height:30px}.cleared-profit{min-width:74px;text-align:right;font-variant-numeric:tabular-nums}.trade-list{padding:4px 20px 8px;display:grid;gap:3px;font-size:11px;opacity:.78}.trade-line{display:flex;justify-content:space-between;gap:8px}.trade-line span:last-child{opacity:.72}.holdings-group .stock{min-height:30px}.holdings-group .stock-main{min-height:24px}
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;padding:8px;color:var(--vscode-foreground);font:12px var(--vscode-font-family);background:var(--vscode-sideBar-background)}button,input,select{font:inherit;color:inherit;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:3px;padding:4px 6px}button{cursor:pointer}button:hover{background:var(--vscode-list-hoverBackground)}.toolbar{display:flex;gap:4px;margin-bottom:7px}.toolbar input{min-width:0;flex:1}#app{--tree-column:18px}.group{margin:0;overflow:visible}.group-head{display:flex;align-items:center;gap:0;min-height:28px;padding:3px 2px;cursor:pointer}.tree-arrow{display:grid;place-items:center;flex:0 0 var(--tree-column);width:var(--tree-column);height:22px;color:var(--vscode-icon-foreground,var(--vscode-foreground));opacity:.82}.tree-arrow::before{content:'';width:6px;height:6px;border-right:1px solid currentColor;border-bottom:1px solid currentColor;transform:rotate(-45deg)}.tree-arrow.expanded::before{transform:rotate(45deg)}.group-name{font-weight:600;flex:1;min-width:0;padding-left:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.group-meta{opacity:.7;font-size:11px}.group-actions{display:flex;gap:2px}.group-actions button{padding:1px 4px;border:0;background:transparent}.market-overview{position:sticky;top:0;z-index:12;margin-bottom:3px;padding-bottom:3px;background:var(--vscode-sideBar-background);border-bottom:1px solid var(--vscode-tree-indentGuidesStroke,rgba(128,128,128,.2))}.market-row{height:31px;padding:2px;display:grid;grid-template-columns:minmax(62px,1fr) 58px 50px 50px;align-items:center;gap:3px;cursor:pointer;border-radius:3px}.market-row:hover{background:var(--vscode-list-hoverBackground)}.market-row.current{background:var(--vscode-list-activeSelectionBackground)}.market-name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.market-price,.market-pct{text-align:right;font-variant-numeric:tabular-nums}.market-spark{width:50px;height:21px;overflow:visible}.market-spark .zero{stroke:var(--vscode-tree-indentGuidesStroke,rgba(128,128,128,.28));stroke-width:.7;stroke-dasharray:2 2}.market-spark .line{fill:none;stroke:var(--vscode-descriptionForeground);stroke-width:1.2;vector-effect:non-scaling-stroke}.group-children{margin-left:10px;padding-left:10px;border-left:1px solid var(--vscode-tree-indentGuidesStroke,rgba(128,128,128,.25))}.group-children:empty{display:none}.group-children .stock{position:relative;margin-left:0}.group-children .stock::before{content:'';position:absolute;left:-10px;top:50%;width:7px;border-top:1px solid var(--vscode-tree-indentGuidesStroke,rgba(128,128,128,.25));pointer-events:none}.stock{padding:4px 2px;cursor:pointer;min-height:28px}.stock:hover{background:var(--vscode-list-hoverBackground)}.stock.current{background:var(--vscode-list-activeSelectionBackground)}.stock-main{display:flex;align-items:center;gap:7px;min-width:0}.stock-main .name{font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.alert-dot{width:5px;height:5px;border-radius:50%;background:var(--vscode-descriptionForeground);opacity:.62;flex:0 0 5px}.price{text-align:right;min-width:48px}.pct{text-align:right;min-width:48px}.alert-center{border-bottom:1px solid var(--vscode-tree-indentGuidesStroke,rgba(128,128,128,.18));margin-bottom:2px}.alert-block-title{padding:3px 4px 2px 20px;font-size:10px;text-transform:uppercase;opacity:.55}.alert-row{min-height:27px;padding:3px 3px 3px 20px;display:flex;align-items:center;gap:5px}.alert-row:hover{background:var(--vscode-list-hoverBackground)}.alert-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.alert-time{font-size:10px;opacity:.55}.alert-row button{border:0;background:transparent;padding:1px 3px;opacity:.65}.alert-row button:hover{opacity:1}.alert-empty{padding:4px 4px 6px 20px;opacity:.55}.dragging{opacity:.42}.drop-before{box-shadow:inset 0 1px 0 var(--vscode-focusBorder)}.drop-after{box-shadow:inset 0 -1px 0 var(--vscode-focusBorder)}.stock-menu{position:relative;flex:0 0 18px}.stock-menu summary{list-style:none;cursor:pointer;text-align:center;opacity:.5;font-weight:700}.stock-menu summary::-webkit-details-marker{display:none}.stock-menu[open] summary,.stock-menu summary:hover{opacity:1}.stock-menu-panel{position:absolute;z-index:20;right:-3px;top:20px;width:142px;padding:5px;display:grid;gap:4px;background:var(--vscode-menu-background,var(--vscode-sideBar-background));border:1px solid var(--vscode-menu-border,var(--vscode-sideBar-border));border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,.35)}.stock-menu-panel select,.stock-menu-panel button{width:100%;text-align:left}.holdings-group{position:sticky;top:126px;z-index:10;background:var(--vscode-sideBar-background);padding-bottom:2px}.holding .name::after{content:'·';margin-left:3px;opacity:.7}.result{display:flex;align-items:center;gap:5px;padding:5px;border-top:1px solid var(--vscode-tree-indentGuidesStroke)}.result span:first-child{flex:1}.results{margin-bottom:7px}.empty,.error{padding:8px;opacity:.7}.error{color:var(--vscode-editorWarning-foreground)}.modal{position:fixed;z-index:100;inset:0;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(0,0,0,.48)}.modal-card{width:min(280px,100%);padding:10px;background:var(--vscode-editorWidget-background,var(--vscode-sideBar-background));border:1px solid var(--vscode-widget-border,var(--vscode-sideBar-border));border-radius:5px;box-shadow:0 8px 24px rgba(0,0,0,.45)}.modal-title{font-weight:600;margin-bottom:9px}.modal-fields{display:grid;gap:8px}.modal-field{display:grid;gap:4px}.modal-field span{opacity:.72}.modal-field input,.modal-field select{width:100%}.modal-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:11px}.danger{color:var(--vscode-errorForeground)}.hidden{display:none}
</style></head><body><div class="toolbar"><input id="search" placeholder="输入股票名称或代码"><button id="searchBtn">搜索</button><button id="groupBtn">分组</button></div><div id="results" class="results"></div><div id="app">${initialMarkup}</div><div id="error" class="error hidden"></div><div id="modal" class="modal hidden"><div class="modal-card" role="dialog" aria-modal="true"><div id="modalTitle" class="modal-title"></div><div id="modalFields" class="modal-fields"></div><div class="modal-actions"><button id="modalCancel">取消</button><button id="modalConfirm">确定</button></div></div></div>
<script nonce="${nonce}">
(() => { const vscode=acquireVsCodeApi(); let state=${initialState}; let structureKey=''; let modalAction; let marketCollapsed=false; let alertsCollapsed=true; let holdingsCollapsed=false; let clearedCollapsed=true; let menuCloseTimer; let dragPayload; let suppressClick=false; const $=s=>document.querySelector(s); const search=$('#search');
function errorText(value){return value instanceof Error?value.message:String(value??'未知错误')}function showError(message){const el=$('#error');if(!el)return;el.textContent=message;el.classList.remove('hidden')}function renderSafely(){try{render()}catch(error){showError('自选股渲染失败：'+errorText(error))}}function updateDynamicSafely(){try{updateDynamic()}catch(error){showError('行情更新失败：'+errorText(error))}}
window.addEventListener('error',event=>showError('自选股页面错误：'+errorText(event.error||event.message)));window.addEventListener('unhandledrejection',event=>showError('自选股页面错误：'+errorText(event.reason)));
$('#searchBtn').onclick=()=>vscode.postMessage({type:'search',query:search.value});search.onkeydown=e=>{if(e.key==='Enter')$('#searchBtn').click()};$('#groupBtn').onclick=()=>openDialog({title:'新建分组',fields:[{name:'name',label:'分组名称',value:'',placeholder:'例如：银行'}],submit:v=>{if(!v.name.trim())return false;vscode.postMessage({type:'createGroup',name:v.name})}});
window.addEventListener('message',e=>{const m=e.data||{};if(m.type==='state'){const next=m.payload;const changed=structureSignature(next)!==structureKey;state=next;if(changed)renderSafely();else updateDynamicSafely()}if(m.type==='searchResults')renderResults(m.rows||[]);if(m.type==='error')showError(m.message);if(m.type==='focusSearch')search.focus()});
function structureSignature(value){return JSON.stringify({indices:value.indices.map(i=>[i.key,i.name]),groups:value.groups.map(g=>[g.id,g.name,g.sortOrder,g.collapsed]),entries:value.entries.map(e=>[e.code,e.name,e.groupId,e.sortOrder,e.followed,e.costPrice,e.shares]),rules:(value.alerts?.rules||[]).map(r=>[r.id,r.code,r.type,r.threshold,r.severity,r.enabled,r.updatedAt]),events:(value.alerts?.events||[]).map(e=>[e.id,e.code,e.read]),positions:(value.portfolio?.positions||[]).map(p=>[p.id,p.code,p.shares,p.averageCost,p.updatedAt]),cleared:(value.portfolio?.cleared||[]).map(c=>[c.id,c.code,c.realizedProfit,c.returnPercent,c.closedAt])})}
function isHoldingEntry(entry){return Number(entry.shares)>0&&Number(entry.costPrice)>0}
function render(){structureKey=structureSignature(state);const app=$('#app');app.textContent='';app.appendChild(marketSection());app.appendChild(alertCenter());const holdings=state.entries.filter(isHoldingEntry);if(holdings.length)app.appendChild(groupSection('持仓','__holdings__',holdings,holdingsCollapsed,true));const scroll=document.createElement('div');scroll.className='stock-list-scroll';if(!state.entries.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='暂无自选股，搜索名称或代码后添加';scroll.appendChild(empty)}else{const followedGroup=state.groups.find(g=>g.id==='${DEFAULT_GROUP_ID}');if(followedGroup){const followed=state.entries.filter(x=>x.followed);scroll.appendChild(groupSection('我的关注',followedGroup.id,followed,followedGroup.collapsed,false,followedGroup,true))}state.groups.slice().sort((a,b)=>a.sortOrder-b.sortOrder).filter(g=>g.id!=='${DEFAULT_GROUP_ID}').forEach(g=>{const entries=state.entries.filter(x=>x.groupId===g.id&&!isHoldingEntry(x));scroll.appendChild(groupSection(g.name,g.id,entries,g.collapsed,false,g,false))})}if(state.portfolio?.cleared?.length)scroll.appendChild(clearedSection(state.portfolio.cleared));app.appendChild(scroll);updateDynamic()}
function marketSection(){const wrap=document.createElement('section');wrap.className='market-overview'+(marketCollapsed?' collapsed':'');const head=document.createElement('div');head.className='group-head';head.setAttribute('aria-expanded',String(!marketCollapsed));head.innerHTML='<span class="tree-arrow'+(marketCollapsed?'':' expanded')+'" aria-hidden="true"></span><span class="group-name">大盘走势</span><span class="group-meta">三大指数</span>';head.onclick=()=>{marketCollapsed=!marketCollapsed;renderSafely()};wrap.appendChild(head);if(!marketCollapsed){const rows=document.createElement('div');rows.className='market-rows';state.indices.forEach(index=>{const row=document.createElement('div');row.className='market-row';row.dataset.indexKey=index.key;row.onclick=event=>{event.stopPropagation();vscode.postMessage({type:'selectIndex',code:index.key})};row.innerHTML='<span class="market-name"></span><span class="market-price"></span><span class="market-pct"></span><svg class="market-spark" viewBox="0 0 50 21" preserveAspectRatio="none"><path class="zero" d="M0 10.5H50"></path><path class="line"></path></svg>';row.querySelector('.market-name').textContent=index.name;rows.appendChild(row)});wrap.appendChild(rows)}return wrap}
function alertCenter(){const rules=state.alerts?.rules||[];const events=state.alerts?.events||[];const unread=events.filter(e=>!e.read).length;const paused=rules.filter(r=>!r.enabled);const wrap=document.createElement('section');wrap.className='alert-center';const head=document.createElement('div');head.className='group-head';head.setAttribute('aria-expanded',String(!alertsCollapsed));head.innerHTML='<span class="tree-arrow'+(alertsCollapsed?'':' expanded')+'" aria-hidden="true"></span><span class="group-name">提醒中心</span><span class="group-meta">'+(unread?unread+'条未读':rules.length+'条规则')+'</span>';head.onclick=()=>{alertsCollapsed=!alertsCollapsed;renderSafely()};wrap.appendChild(head);if(alertsCollapsed)return wrap;const body=document.createElement('div');if(events.length){body.appendChild(alertTitle('今日已触发'));events.slice(0,20).forEach(event=>{const row=document.createElement('div');row.className='alert-row';row.title=event.message;row.innerHTML='<span class="alert-text"></span><span class="alert-time"></span><button title="今日不再提醒">×</button>';row.querySelector('.alert-text').textContent=(event.read?'':'• ')+event.stockName+' '+event.title;row.querySelector('.alert-time').textContent=formatTime(event.triggeredAt);row.onclick=()=>{vscode.postMessage({type:'select',code:event.code});vscode.postMessage({type:'alertRead',ruleId:event.id})};row.querySelector('button').onclick=e=>{e.stopPropagation();vscode.postMessage({type:'alertMute',ruleId:event.ruleId})};body.appendChild(row)})}else{const empty=document.createElement('div');empty.className='alert-empty';empty.textContent='今天还没有触发提醒';body.appendChild(empty)}if(paused.length){body.appendChild(alertTitle('已暂停'));paused.forEach(rule=>body.appendChild(alertRuleRow(rule)))}if(rules.length){body.appendChild(alertTitle('全部规则'));rules.filter(r=>r.enabled).forEach(rule=>body.appendChild(alertRuleRow(rule)))}wrap.appendChild(body);return wrap}
function alertTitle(text){const el=document.createElement('div');el.className='alert-block-title';el.textContent=text;return el}function alertRuleRow(rule){const entry=state.entries.find(e=>e.code===rule.code);const row=document.createElement('div');row.className='alert-row';row.innerHTML='<span class="alert-text"></span><button class="toggle"></button><button class="delete" title="删除规则">×</button>';row.querySelector('.alert-text').textContent=(entry?.name||rule.code)+' '+alertRuleLabel(rule)+' '+fmtAlertThreshold(rule);const toggle=row.querySelector('.toggle');toggle.textContent=rule.enabled?'暂停':'恢复';toggle.onclick=()=>vscode.postMessage({type:'alertToggle',ruleId:rule.id});row.querySelector('.delete').onclick=()=>vscode.postMessage({type:'alertRemove',ruleId:rule.id});return row}
function clearedSection(rows){const wrap=document.createElement('section');wrap.className='group cleared-group';const head=document.createElement('div');head.className='group-head';head.setAttribute('aria-expanded',String(!clearedCollapsed));head.innerHTML='<span class="tree-arrow'+(clearedCollapsed?'':' expanded')+'" aria-hidden="true"></span><span class="group-name">已清仓</span><span class="group-meta">'+rows.length+'条记录</span>';head.onclick=()=>{clearedCollapsed=!clearedCollapsed;renderSafely()};wrap.appendChild(head);if(clearedCollapsed)return wrap;const children=document.createElement('div');children.className='group-children';rows.forEach(item=>{const row=document.createElement('div');row.className='stock cleared-row';row.innerHTML='<div class="stock-main"><span class="name"></span><span class="cleared-profit"></span><span class="pct"></span><details class="stock-menu"><summary title="更多操作">···</summary><div class="stock-menu-panel"><button class="trades">查看交易记录</button><button class="delete">删除清仓记录</button></div></details></div>';row.title='买入 '+fmtMoney(item.totalBuyAmount)+'  卖出 '+fmtMoney(item.totalSellAmount)+'  清仓 '+formatTime(item.closedAt);row.querySelector('.name').textContent=item.stockName;row.querySelector('.cleared-profit').textContent=fmtMoney(item.realizedProfit);row.querySelector('.pct').textContent=fmtPct(item.returnPercent);row.querySelector('.trades').onclick=e=>{e.stopPropagation();vscode.postMessage({type:'trades',clearedId:item.id})};row.querySelector('.delete').onclick=e=>{e.stopPropagation();openDialog({title:'删除 '+item.stockName+' 清仓记录？',confirmLabel:'删除',danger:true,submit:()=>vscode.postMessage({type:'deleteCleared',clearedId:item.id})})};children.appendChild(row)});wrap.appendChild(children);return wrap}
function groupSection(name,id,entries,collapsed,isHoldings,group,isFollowed=false){const wrap=document.createElement('section');wrap.className='group'+(isHoldings?' holdings-group':'');wrap.dataset.groupId=id;if(isHoldings)wrap.dataset.holdings='true';if(isFollowed)wrap.dataset.followed='true';const head=document.createElement('div');head.className='group-head';head.setAttribute('aria-expanded',String(!collapsed));head.onclick=()=>{if(suppressClick)return;if(isHoldings){holdingsCollapsed=!holdingsCollapsed;renderSafely()}else vscode.postMessage({type:'toggleGroup',groupId:id})};const canRename=!isHoldings&&!isFollowed;head.innerHTML='<span class="tree-arrow'+(collapsed?'':' expanded')+'" aria-hidden="true"></span><span class="group-name"></span><span class="group-meta"></span><span class="group-actions">'+(canRename?'<button title="重命名">✎</button>':'')+'</span>';head.querySelector('.group-name').textContent=name;const action=head.querySelector('button');if(action)action.onclick=e=>{e.stopPropagation();openDialog({title:'重命名分组',fields:[{name:'name',label:'分组名称',value:group.name}],submit:v=>{if(v.name.trim())vscode.postMessage({type:'renameGroup',groupId:id,name:v.name})}})};if(!isHoldings&&!isFollowed)enableGroupDrag(head,id);wrap.appendChild(head);if(!collapsed&&entries.length){const children=document.createElement('div');children.className='group-children';entries.forEach(entry=>children.appendChild(stockCard(entry,!isHoldings&&!isFollowed)));wrap.appendChild(children)}return wrap}
 function stockCard(entry,canDrag){const el=document.createElement('div');el.className='stock';el.dataset.code=entry.code;el.onclick=()=>{if(!suppressClick)vscode.postMessage({type:'select',code:entry.code})};el.innerHTML='<div class="stock-main"><span class="name"></span><span class="price"></span><span class="pct"></span><details class="stock-menu"><summary title="更多操作">···</summary><div class="stock-menu-panel"><select class="group-select" title="移动到分组"></select><button class="buy">买入</button><button class="sell">卖出</button><button class="trades">查看交易记录</button><button class="alert">设置盘中提醒</button><button class="follow"></button><button class="edit">设置持仓</button><button class="remove">删除股票</button></div></details></div>';const menu=el.querySelector('.stock-menu');menu.onclick=e=>e.stopPropagation();menu.onmouseenter=cancelMenuClose;menu.onmouseleave=()=>scheduleMenuClose(menu);menu.ontoggle=()=>{if(menu.open)closeStockMenus(menu)};const groupSelect=el.querySelector('.group-select');state.groups.slice().sort((a,b)=>a.sortOrder-b.sortOrder).filter(g=>g.id!=='${DEFAULT_GROUP_ID}'||entry.groupId==='${DEFAULT_GROUP_ID}').forEach(g=>{const o=document.createElement('option');o.value=g.id;o.textContent=g.id==='${DEFAULT_GROUP_ID}'?'我的关注':g.name;o.selected=g.id===entry.groupId;groupSelect.appendChild(o)});groupSelect.onfocus=cancelMenuClose;groupSelect.onblur=()=>scheduleMenuClose(menu);groupSelect.onchange=e=>{e.stopPropagation();vscode.postMessage({type:'move',code:entry.code,groupId:groupSelect.value});menu.removeAttribute('open')};el.querySelector('.buy').onclick=e=>{e.stopPropagation();menu.removeAttribute('open');configureTrade(entry,'buy')};const position=state.portfolio?.positions?.find(p=>p.code===entry.code);const sell=el.querySelector('.sell');sell.disabled=!position;sell.title=position?'':'当前没有可卖持仓';sell.onclick=e=>{e.stopPropagation();if(!position)return;menu.removeAttribute('open');configureTrade(entry,'sell')};const trades=el.querySelector('.trades');trades.disabled=!position;trades.title=position?'':'当前没有交易流水';trades.onclick=e=>{e.stopPropagation();if(!position)return;menu.removeAttribute('open');showTrades(entry)};el.querySelector('.alert').onclick=e=>{e.stopPropagation();menu.removeAttribute('open');configureAlert(entry)};const follow=el.querySelector('.follow');follow.textContent=entry.followed?'取消关注':'关注';follow.onclick=e=>{e.stopPropagation();menu.removeAttribute('open');vscode.postMessage({type:entry.followed?'unfollow':'follow',code:entry.code})};const edit=el.querySelector('.edit');const hasRealTrades=position&&(state.portfolio?.trades||[]).some(t=>t.positionId===position.id&&!t.legacy);edit.disabled=Boolean(hasRealTrades);edit.title=hasRealTrades?'已有交易流水，请使用买入或卖出调整':'';edit.onclick=e=>{e.stopPropagation();if(hasRealTrades)return;menu.removeAttribute('open');editHolding(entry)};el.querySelector('.remove').onclick=e=>{e.stopPropagation();menu.removeAttribute('open');openDialog({title:'删除 '+entry.name+'？',confirmLabel:'删除',danger:true,submit:()=>vscode.postMessage({type:'remove',code:entry.code})})};if(canDrag)enableStockDrag(el,entry);return el}
function enableGroupDrag(head,groupId){head.draggable=true;head.ondragstart=event=>{if(event.target.closest('button')){event.preventDefault();return}beginDrag(event,{kind:'group',groupId},head)};head.ondragover=event=>{if(dragPayload?.kind!=='group'||dragPayload.groupId===groupId)return;event.preventDefault();event.dataTransfer.dropEffect='move';markDrop(head,dropPosition(event,head))};head.ondrop=event=>{if(dragPayload?.kind!=='group'||dragPayload.groupId===groupId)return;event.preventDefault();const position=dropPosition(event,head);vscode.postMessage({type:'reorderGroup',groupId:dragPayload.groupId,targetGroupId:groupId,position});finishDrag()};head.ondragleave=event=>{if(!head.contains(event.relatedTarget))clearDropMarks()};head.ondragend=finishDrag;head.addEventListener('dragover',event=>{if(dragPayload?.kind==='stock'){event.preventDefault();event.dataTransfer.dropEffect='move';markDrop(head,'after')}});head.addEventListener('drop',event=>{if(dragPayload?.kind!=='stock')return;event.preventDefault();vscode.postMessage({type:'placeStock',code:dragPayload.code,targetGroupId:groupId,position:'after'});finishDrag()})}
function enableStockDrag(el,entry){el.draggable=true;el.ondragstart=event=>{if(event.target.closest('.stock-menu')){event.preventDefault();return}beginDrag(event,{kind:'stock',code:entry.code},el)};el.ondragover=event=>{if(dragPayload?.kind!=='stock'||dragPayload.code===entry.code)return;event.preventDefault();event.dataTransfer.dropEffect='move';markDrop(el,dropPosition(event,el))};el.ondrop=event=>{if(dragPayload?.kind!=='stock'||dragPayload.code===entry.code)return;event.preventDefault();const position=dropPosition(event,el);vscode.postMessage({type:'placeStock',code:dragPayload.code,targetGroupId:entry.groupId,targetCode:entry.code,position});finishDrag()};el.ondragleave=event=>{if(!el.contains(event.relatedTarget))clearDropMarks()};el.ondragend=finishDrag}
function beginDrag(event,payload,element){closeStockMenus();dragPayload=payload;suppressClick=true;element.classList.add('dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',JSON.stringify(payload))}function finishDrag(){dragPayload=void 0;clearDropMarks();document.querySelectorAll('.dragging').forEach(el=>el.classList.remove('dragging'));setTimeout(()=>{suppressClick=false},0)}function dropPosition(event,element){return event.clientY<element.getBoundingClientRect().top+element.getBoundingClientRect().height/2?'before':'after'}function markDrop(element,position){clearDropMarks();element.classList.add(position==='before'?'drop-before':'drop-after')}function clearDropMarks(){document.querySelectorAll('.drop-before,.drop-after').forEach(el=>el.classList.remove('drop-before','drop-after'))}
function cancelMenuClose(){if(menuCloseTimer!==void 0){clearTimeout(menuCloseTimer);menuCloseTimer=void 0}}function closeStockMenus(except){cancelMenuClose();document.querySelectorAll('.stock-menu[open]').forEach(menu=>{if(menu!==except)menu.removeAttribute('open')})}function scheduleMenuClose(menu){cancelMenuClose();menuCloseTimer=setTimeout(()=>{menuCloseTimer=void 0;const active=document.activeElement;if(menu.matches(':hover')||(active?.tagName==='SELECT'&&menu.contains(active)))return;menu.removeAttribute('open')},250)}function eventInsideMenu(event){return event.target instanceof Element&&Boolean(event.target.closest('.stock-menu'))}
function updateDynamic(){updateMarkets();document.querySelectorAll('.group[data-group-id]').forEach(section=>{const isHoldings=section.dataset.holdings==='true';const isFollowed=section.dataset.followed==='true';const entries=isHoldings?state.entries.filter(isHoldingEntry):isFollowed?state.entries.filter(e=>e.followed):state.entries.filter(e=>e.groupId===section.dataset.groupId&&!isHoldingEntry(e));const pct=groupChange(entries);const meta=section.querySelector('.group-meta');if(meta){meta.textContent=entries.length+'只 '+fmtPct(pct);setTone(meta,pct)}});document.querySelectorAll('.stock[data-code]').forEach(el=>{const entry=state.entries.find(e=>e.code===el.dataset.code);if(entry)updateStockRow(el,entry)})}
function updateMarkets(){document.querySelectorAll('.market-row[data-index-key]').forEach(row=>{const key=row.dataset.indexKey;const index=state.indices.find(i=>i.key===key);const quote=state.snapshot.indexQuotes?.[key];const points=state.snapshot.indexIntraday?.[key]||[];row.classList.toggle('current',key===state.snapshot.currentIndexKey);row.querySelector('.market-name').textContent=quote?.name||index?.name||key;row.querySelector('.market-price').textContent=fmt(quote?.price);row.querySelector('.market-pct').textContent=fmtPct(quote?.changePercent);const path=row.querySelector('.market-spark .line');if(path)path.setAttribute('d',sparkPath(points,quote?.previousClose))})}
function sparkPath(points,previousClose){if(!points.length)return'';const values=points.map(p=>Number(p.price)).filter(Number.isFinite);if(!values.length)return'';const base=Number.isFinite(Number(previousClose))?Number(previousClose):values[0];const delta=Math.max(...values.map(value=>Math.abs(value-base)),Math.abs(base)*.001);return values.map((value,index)=>(index?'L':'M')+(index/Math.max(1,values.length-1)*50).toFixed(1)+' '+(10.5-(value-base)/delta*8.5).toFixed(1)).join(' ')}
function updateStockRow(el,entry){const quote=state.snapshot.quotes[entry.code];const price=quote&&quote.price;const pct=quote&&quote.changePercent;const holding=Number(entry.shares)>0&&Number(entry.costPrice)>0;const profit=holding&&price!=null?(price-entry.costPrice)*entry.shares:void 0;const profitPct=holding&&price!=null?(price-entry.costPrice)/entry.costPrice*100:void 0;el.classList.toggle('current',!state.snapshot.currentIndexKey&&entry.code===state.currentCode);el.classList.toggle('holding',holding);const name=el.querySelector('.name');name.textContent='';if(state.alerts?.events?.some(e=>e.code===entry.code&&!e.read)){const dot=document.createElement('span');dot.className='alert-dot';name.appendChild(dot)}name.append(quote?.name||entry.name);el.querySelector('.price').textContent=fmt(price);setTone(el.querySelector('.price'),pct);el.querySelector('.pct').textContent=fmtPct(pct);setTone(el.querySelector('.pct'),pct);const tips=[quote?.name||entry.name,'最新 '+fmt(price)+'  涨跌 '+fmtPct(pct),'成交额 '+fmtMoney(quote?.amount),'量比 '+fmt(quote?.volumeRatio),'换手率 '+fmtPct(quote?.turnoverRate)];if(holding){tips.push('成本 '+fmt(entry.costPrice)+'  股数 '+entry.shares);tips.push('持仓盈亏 '+fmtMoney(profit)+'  '+fmtPct(profitPct))}el.title=tips.join('\\n')}
function editHolding(entry){openDialog({title:'设置 '+entry.name+' 持仓',fields:[{name:'costPrice',label:'成本价（留空清除持仓）',value:entry.costPrice??'',type:'number'},{name:'shares',label:'持仓股数',value:entry.shares??'',type:'number'}],submit:v=>vscode.postMessage({type:'holding',code:entry.code,costPrice:v.costPrice,shares:v.costPrice.trim()?v.shares:''})})}
function configureAlert(entry){openDialog({title:'设置 '+entry.name+' 盘中提醒',fields:[{name:'ruleType',label:'提醒规则',value:'price-above',type:'select',options:[['price-above','价格突破'],['price-below','价格跌破'],['change-rise','涨幅达到'],['change-fall','跌幅达到'],['holding-profit','持仓盈利达到'],['holding-loss','持仓亏损达到'],['volume-ratio','量比达到'],['amount-spike','最新分钟放量'],['turnover','换手率达到'],['rapid-rise','3分钟快速上涨'],['rapid-fall','3分钟快速下跌'],['relative-strength','相对大盘强势'],['relative-weakness','相对大盘弱势']]},{name:'threshold',label:'阈值',value:'',type:'number'},{name:'severity',label:'提醒等级',value:'normal',type:'select',options:[['preview','预告'],['normal','普通'],['important','重要']]}],submit:v=>{if(!v.threshold.trim())return false;vscode.postMessage({type:'alertCreate',code:entry.code,ruleType:v.ruleType,threshold:v.threshold,severity:v.severity})}})}
function configureTrade(entry,side){const quote=state.snapshot.quotes[entry.code];const currentShares=Number(entry.shares)||0;openDialog({title:(side==='buy'?'买入 ':'卖出 ')+entry.name,fields:[{name:'price',label:'成交价格',value:quote?.price??'',type:'number'},{name:'shares',label:side==='sell'?'卖出股数（最多 '+currentShares+' 股）':'买入股数',value:side==='sell'&&currentShares?currentShares:'',type:'number'},{name:'note',label:'备注（可选）',value:''}],submit:v=>{const price=Number(v.price),shares=Number(v.shares);if(!Number.isFinite(price)||price<=0||!Number.isInteger(shares)||shares<=0||(side==='sell'&&shares>currentShares))return false;vscode.postMessage({type:side,code:entry.code,price:v.price,shares:v.shares,note:v.note})}})}function showTrades(entry){const position=state.portfolio?.positions?.find(p=>p.code===entry.code);if(position)vscode.postMessage({type:'trades',positionId:position.id})}
function openDialog(options){const modal=$('#modal');const fields=$('#modalFields');$('#modalTitle').textContent=options.title;fields.textContent='';(options.fields||[]).forEach(field=>{const label=document.createElement('label');label.className='modal-field';const text=document.createElement('span');text.textContent=field.label;let input;if(field.type==='select'){input=document.createElement('select');(field.options||[]).forEach(option=>{const item=document.createElement('option');item.value=option[0];item.textContent=option[1];item.selected=option[0]===field.value;input.appendChild(item)})}else{input=document.createElement('input');input.type=field.type||'text';input.value=String(field.value??'');input.placeholder=field.placeholder||'';if(input.type==='number'){input.min='0';input.step='any'}}input.name=field.name;label.append(text,input);fields.appendChild(label)});const confirm=$('#modalConfirm');confirm.textContent=options.confirmLabel||'确定';confirm.classList.toggle('danger',Boolean(options.danger));modalAction=()=>{const values={};fields.querySelectorAll('input,select').forEach(input=>values[input.name]=input.value);if(options.submit(values)!==false)closeDialog()};modal.classList.remove('hidden');setTimeout(()=>fields.querySelector('input,select')?.focus(),0)}
function closeDialog(){$('#modal').classList.add('hidden');modalAction=void 0}$('#modalConfirm').onclick=()=>modalAction?.();$('#modalCancel').onclick=closeDialog;$('#modal').onclick=e=>{if(e.target===$('#modal'))closeDialog()};window.addEventListener('keydown',e=>{if(!$('#modal').classList.contains('hidden')){if(e.key==='Escape')closeDialog();if(e.key==='Enter')modalAction?.()}});document.addEventListener('pointerdown',event=>{if(!eventInsideMenu(event))closeStockMenus()});document.addEventListener('wheel',event=>{if(!eventInsideMenu(event))closeStockMenus()},{capture:true});window.addEventListener('blur',()=>closeStockMenus());document.addEventListener('visibilitychange',()=>{if(document.hidden)closeStockMenus()});
function renderResults(rows){const box=$('#results');box.textContent='';if(!rows.length){box.innerHTML='<div class="empty">未找到沪深 A 股</div>';return}rows.forEach(row=>{const el=document.createElement('div');el.className='result';const span=document.createElement('span');span.textContent=row.name+' '+row.code;const select=document.createElement('select');state.groups.forEach(g=>{const o=document.createElement('option');o.value=g.id;o.textContent=g.name;select.appendChild(o)});const btn=document.createElement('button');btn.textContent='添加';btn.onclick=()=>vscode.postMessage({type:'addSearch',code:row.code,groupId:select.value});el.append(span,select,btn);box.appendChild(el)})}
function groupChange(entries){let change=0,base=0;entries.forEach(e=>{const q=state.snapshot.quotes[e.code];if(q?.price!=null&&q.previousClose!=null){change+=q.price-q.previousClose;base+=q.previousClose}});return base?change/base*100:void 0}
function alertRuleLabel(rule){return{'price-above':'价格突破','price-below':'价格跌破','change-rise':'涨幅达到','change-fall':'跌幅达到','volume-ratio':'量比达到','turnover':'换手率达到','rapid-rise':'3分钟快速上涨','rapid-fall':'3分钟快速下跌','holding-profit':'持仓盈利','holding-loss':'持仓亏损','amount-spike':'分钟放量','relative-strength':'相对大盘强势','relative-weakness':'相对大盘弱势'}[rule.type]||rule.type}function fmtAlertThreshold(rule){return Number(rule.threshold).toFixed(2)+(rule.type==='price-above'||rule.type==='price-below'?'':rule.type==='volume-ratio'||rule.type==='amount-spike'?'倍':'%')}function formatTime(value){const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):''}
function fmt(v){return v==null||!Number.isFinite(Number(v))?'--':Number(v).toFixed(2)}function fmtPct(v){return v==null||!Number.isFinite(Number(v))?'--':(Number(v)>=0?'+':'')+Number(v).toFixed(2)+'%'}function fmtMoney(v){if(v==null||!Number.isFinite(Number(v)))return'--';const n=Number(v);return(n>=0?'+':'')+(Math.abs(n)>=1e4?(n/1e4).toFixed(2)+'万':n.toFixed(2))}function setTone(el,v){void el;void v}
renderSafely();vscode.postMessage({type:'ready'});
})();
</script></body></html>`;
  }
}

function initialWatchlistMarkup(indices: readonly StockRef[], groups: readonly WatchlistGroup[], entries: readonly WatchlistEntry[]): string {
  const marketMarkup = `<section class="market-overview"><div class="group-head" aria-expanded="true"><span class="tree-arrow expanded" aria-hidden="true"></span><span class="group-name">大盘走势</span><span class="group-meta">三大指数</span></div><div class="market-rows">${indices.map((index) => `<div class="market-row"><span class="market-name">${escapeHtml(index.name)}</span><span class="market-price">--</span><span class="market-pct">--</span><svg class="market-spark" viewBox="0 0 50 21" preserveAspectRatio="none"><path class="zero" d="M0 10.5H50"></path><path class="line"></path></svg></div>`).join('')}</div></section>`;
  if (!entries.length) return marketMarkup + '<div class="empty">暂无自选股，搜索名称或代码后添加</div>';
  const isHolding = (entry: WatchlistEntry) => Number(entry.shares) > 0 && Number(entry.costPrice) > 0;
  const holdings = entries.filter(isHolding);
  const holdingsMarkup = holdings.length ? `<section class="group holdings-group"><div class="group-head" aria-expanded="true"><span class="tree-arrow expanded" aria-hidden="true"></span><span class="group-name">持仓</span><span class="group-meta">${holdings.length}只 --</span></div><div class="group-children">${holdings.map((entry) => `<div class="stock"><div class="stock-main"><span class="name">${escapeHtml(entry.name)}</span><span class="price">--</span><span class="pct">--</span></div></div>`).join('')}</div></section>` : '';
  const followedGroup = groups.find((group) => group.id === DEFAULT_GROUP_ID);
  const followed = entries.filter((entry) => entry.followed);
  const followedStocks = followedGroup?.collapsed ? '' : followed.map((entry) => `<div class="stock"><div class="stock-main"><span class="name">${escapeHtml(entry.name)}</span><span class="price">--</span><span class="pct">--</span></div></div>`).join('');
  const followedMarkup = followedGroup ? `<section class="group"><div class="group-head" aria-expanded="${String(!followedGroup.collapsed)}"><span class="tree-arrow${followedGroup.collapsed ? '' : ' expanded'}" aria-hidden="true"></span><span class="group-name">我的关注</span><span class="group-meta">${followed.length}只 --</span></div>${followedStocks ? `<div class="group-children">${followedStocks}</div>` : ''}</section>` : '';
  return marketMarkup + holdingsMarkup + followedMarkup + groups.slice().sort((a, b) => a.sortOrder - b.sortOrder).filter((group) => group.id !== DEFAULT_GROUP_ID).map((group) => {
    const groupEntries = entries.filter((entry) => entry.groupId === group.id && !(Number(entry.shares) > 0 && Number(entry.costPrice) > 0));
    const stocks = group.collapsed ? '' : groupEntries.map((entry) => `<div class="stock"><div class="stock-main"><span class="name">${escapeHtml(entry.name)}</span><span class="price">--</span><span class="pct">--</span></div></div>`).join('');
    return `<section class="group"><div class="group-head" aria-expanded="${String(!group.collapsed)}"><span class="tree-arrow${group.collapsed ? '' : ' expanded'}" aria-hidden="true"></span><span class="group-name">${escapeHtml(group.name)}</span><span class="group-meta">${groupEntries.length}只 --</span></div>${stocks ? `<div class="group-children">${stocks}</div>` : ''}</section>`;
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

function integerOrUndefined(value: unknown): number | undefined {
  const parsed = numberOrUndefined(value);
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
}

function emptyPortfolio(): PortfolioData {
  return { positions: [], trades: [], cleared: [] };
}
