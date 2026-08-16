export type StockMarket = 'SH' | 'SZ';

export interface StockRef {
  code: string;
  secid: string;
  market: StockMarket;
  name: string;
}

export interface StockQuote extends StockRef {
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  amount: number | null;
  suspended: boolean;
}

export interface IntradayPoint {
  time: string;
  price: number;
  averagePrice: number;
  volume: number;
  amount: number;
}

export interface MarketSnapshot {
  quotes: Record<string, StockQuote>;
  currentCode?: string;
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
