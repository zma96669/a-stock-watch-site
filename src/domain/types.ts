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

export interface StockQuote extends StockRef {
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  amount: number | null;
  turnoverRate: number | null;
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
  stale: boolean;
  error?: string;
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
