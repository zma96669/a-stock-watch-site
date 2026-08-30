export type StockMarket = 'SH' | 'SZ';

export interface StockRef {
  code: string;
  secid: string;
  market: StockMarket;
  name: string;
  kind?: 'stock' | 'index';
}

export interface MarketIndexRef extends StockRef {
  key: string;
  kind: 'index';
}

export interface WatchlistEntry extends StockRef {
  groupId: string;
  sortOrder: number;
  followed?: boolean;
  costPrice?: number;
  shares?: number;
}

export interface WatchlistGroup {
  id: string;
  name: string;
  sortOrder: number;
  collapsed: boolean;
}

export type TradeSide = 'buy' | 'sell';

export interface TradeRecord {
  id: string;
  positionId: string;
  code: string;
  stockName: string;
  side: TradeSide;
  price: number;
  shares: number;
  tradedAt: string;
  note?: string;
  legacy?: boolean;
}

export interface PortfolioPosition {
  id: string;
  code: string;
  stockName: string;
  shares: number;
  averageCost: number;
  totalBuyAmount: number;
  totalSellAmount: number;
  realizedProfit: number;
  openedAt: string;
  updatedAt: string;
}

export interface ClearedPosition {
  id: string;
  positionId: string;
  code: string;
  stockName: string;
  totalBuyAmount: number;
  totalSellAmount: number;
  realizedProfit: number;
  returnPercent: number;
  tradeCount: number;
  openedAt: string;
  closedAt: string;
  note?: string;
  trades: TradeRecord[];
}

export interface PortfolioData {
  positions: PortfolioPosition[];
  trades: TradeRecord[];
  cleared: ClearedPosition[];
}

export interface StockQuote extends StockRef {
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  amount: number | null;
  turnoverRate: number | null;
  volumeRatio?: number | null;
  suspended: boolean;
}

export interface IntradayPoint {
  time: string;
  price: number;
  averagePrice: number;
  volume: number;
  amount: number;
  volumeRatio?: number;
}

export interface MarketSnapshot {
  quotes: Record<string, StockQuote>;
  indexQuotes: Record<string, StockQuote>;
  indexIntraday: Record<string, IntradayPoint[]>;
  currentCode?: string;
  currentIndexKey?: string;
  activeQuote?: StockQuote;
  intraday: IntradayPoint[];
  previousClose?: number;
  updatedAt?: string;
  quoteUpdatedAt?: string;
  stale: boolean;
  error?: string;
}

export type AlertSeverity = 'preview' | 'normal' | 'important';

export type AlertRuleType =
  | 'price-above'
  | 'price-below'
  | 'change-rise'
  | 'change-fall'
  | 'holding-profit'
  | 'holding-loss'
  | 'rapid-rise'
  | 'rapid-fall'
  | 'volume-ratio'
  | 'amount-spike'
  | 'turnover'
  | 'relative-strength'
  | 'relative-weakness';

export interface AlertRule {
  id: string;
  code: string;
  type: AlertRuleType;
  threshold: number;
  windowMinutes?: number;
  proximityPercent?: number;
  severity: AlertSeverity;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  code: string;
  stockName: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  title: string;
  message: string;
  value: number;
  threshold: number;
  triggeredAt: string;
  read: boolean;
}

export interface AlertRuleRuntime {
  active: boolean;
  previewActive?: boolean;
  lastTriggeredAt?: string;
  previewLastTriggeredAt?: string;
}

export interface AlertRuntimeData {
  tradingDate: string;
  events: AlertEvent[];
  mutedRuleIds: string[];
  ruleStates: Record<string, AlertRuleRuntime>;
}

export interface MarketDataProvider {
  fetchQuotes(stocks: StockRef[], signal?: AbortSignal): Promise<StockQuote[]>;
  fetchIntraday(stock: StockRef, signal?: AbortSignal): Promise<IntradayPoint[]>;
}

export interface BackgroundOptions {
  visible: boolean;
  opacity: number;
  showAverage: boolean;
  showVolume: boolean;
  lineWidth: number;
}
