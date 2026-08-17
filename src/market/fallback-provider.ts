import type { IntradayPoint, MarketDataProvider, StockQuote, StockRef } from '../domain/types';

type SourceKind = 'quotes' | 'intraday';
type Logger = (message: string) => void;

export class TencentPrimaryProvider implements MarketDataProvider {
  private lastQuoteStatus = '';
  private lastIntradayStatus = '';

  constructor(
    private readonly primary: MarketDataProvider,
    private readonly fallback: MarketDataProvider,
    private readonly logger: Logger = (message) => console.warn(message)
  ) {}

  async fetchQuotes(stocks: StockRef[], signal?: AbortSignal): Promise<StockQuote[]> {
    let primaryRows: StockQuote[] = [];
    let primaryReason = '';
    try {
      primaryRows = await this.primary.fetchQuotes(stocks, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      primaryReason = message(error);
    }
    const valid = new Map(primaryRows.filter(isCompleteQuote).map((quote) => [quote.code, quote]));
    const missing = stocks.filter((stock) => !valid.has(stock.code));
    if (!missing.length) {
      this.report('quotes', 'tencent');
      return stocks.map((stock) => valid.get(stock.code)!);
    }

    let fallbackRows: StockQuote[];
    try {
      fallbackRows = await this.fallback.fetchQuotes(missing, signal);
    } catch (error) {
      throw new Error(`Tencent quotes incomplete (${primaryReason || `${missing.length} missing`}); East Money fallback failed: ${message(error)}`);
    }
    for (const quote of fallbackRows) if (isCompleteQuote(quote)) valid.set(quote.code, quote);
    const unresolved = stocks.filter((stock) => !valid.has(stock.code));
    if (unresolved.length) throw new Error(`No complete quote data for ${unresolved.map((stock) => stock.code).join(', ')}`);
    this.report('quotes', 'fallback', primaryReason || `${missing.length} incomplete`);
    return stocks.map((stock) => valid.get(stock.code)!);
  }

  async fetchIntraday(stock: StockRef, signal?: AbortSignal): Promise<IntradayPoint[]> {
    let primaryReason = '';
    try {
      const points = await this.primary.fetchIntraday(stock, signal);
      if (isCompleteIntraday(points)) {
        this.report('intraday', 'tencent');
        return points;
      }
      primaryReason = 'empty or missing cumulative amount';
    } catch (error) {
      if (signal?.aborted) throw error;
      primaryReason = message(error);
    }
    try {
      const points = await this.fallback.fetchIntraday(stock, signal);
      if (!points.length) throw new Error('empty intraday response');
      this.report('intraday', 'fallback', primaryReason);
      return points;
    } catch (error) {
      throw new Error(`Tencent intraday unavailable (${primaryReason}); East Money fallback failed: ${message(error)}`);
    }
  }

  private report(kind: SourceKind, source: 'tencent' | 'fallback', reason?: string): void {
    const status = `${source}:${reason ?? ''}`;
    const key = kind === 'quotes' ? 'lastQuoteStatus' : 'lastIntradayStatus';
    if (this[key] === status) return;
    this[key] = status;
    this.logger(`A股盯盘 ${kind} source: ${source === 'tencent' ? 'Tencent Finance' : 'East Money'}${reason ? ` (${reason})` : ''}`);
  }
}

function isCompleteQuote(quote: StockQuote): boolean {
  return quote.price !== null && quote.previousClose !== null && quote.amount !== null && quote.turnoverRate !== null;
}

function isCompleteIntraday(points: IntradayPoint[]): boolean {
  return points.length > 0 && points.some((point) => Number.isFinite(point.amount) && point.amount > 0);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
