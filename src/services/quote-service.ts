import { EventEmitter } from 'node:events';
import type { MarketDataProvider, MarketSnapshot, StockQuote, StockRef } from '../domain/types';

const BACKOFF_SECONDS = [5, 10, 20, 30];

export class QuoteService {
  private readonly events = new EventEmitter();
  private timer?: NodeJS.Timeout;
  private controller?: AbortController;
  private running = false;
  private pendingRefresh = false;
  private failures = 0;
  private snapshot: MarketSnapshot = { quotes: {}, intraday: [], stale: false };

  constructor(
    private readonly provider: MarketDataProvider,
    private readonly stocks: () => readonly StockRef[],
    private readonly currentCode: () => string | undefined,
    private readonly intervalSeconds: () => number
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.refreshNow();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.controller?.abort();
    this.events.removeAllListeners();
  }

  getSnapshot(): MarketSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: MarketSnapshot) => void): () => void {
    this.events.on('snapshot', listener);
    listener(this.snapshot);
    return () => this.events.off('snapshot', listener);
  }

  async refreshNow(): Promise<void> {
    if (this.controller) {
      this.pendingRefresh = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.controller = new AbortController();
    try {
      const watchlist = [...this.stocks()];
      const current = watchlist.find((stock) => stock.code === this.currentCode());
      const [quotes, intraday] = await Promise.all([
        this.provider.fetchQuotes(watchlist, this.controller.signal),
        current ? this.provider.fetchIntraday(current, this.controller.signal) : Promise.resolve([])
      ]);
      const quoteRecord = Object.fromEntries(quotes.map((quote) => [quote.code, quote])) as Record<string, StockQuote>;
      const currentQuote = current ? quoteRecord[current.code] : undefined;
      this.failures = 0;
      this.snapshot = {
        quotes: quoteRecord,
        currentCode: current?.code,
        intraday,
        previousClose: currentQuote?.previousClose ?? undefined,
        updatedAt: new Date().toISOString(),
        stale: false
      };
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.failures += 1;
        this.snapshot = {
          ...this.snapshot,
          stale: true,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    } finally {
      this.controller = undefined;
      this.events.emit('snapshot', this.snapshot);
      if (this.running) {
        if (this.pendingRefresh) {
          this.pendingRefresh = false;
          queueMicrotask(() => void this.refreshNow());
        } else {
          this.schedule();
        }
      }
    }
  }

  private schedule(): void {
    const configured = Math.max(3, Math.min(60, this.intervalSeconds()));
    const seconds = this.failures === 0
      ? configured
      : BACKOFF_SECONDS[Math.min(this.failures - 1, BACKOFF_SECONDS.length - 1)];
    this.timer = setTimeout(() => void this.refreshNow(), seconds * 1000);
  }
}
