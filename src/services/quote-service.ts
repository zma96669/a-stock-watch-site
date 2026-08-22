import { EventEmitter } from 'node:events';
import type { IntradayPoint, MarketDataProvider, MarketSnapshot, StockQuote, StockRef } from '../domain/types';
import { addVolumeRatios } from './market-metrics';

const BACKOFF_SECONDS = [5, 10, 20, 30];

export class QuoteService {
  private readonly events = new EventEmitter();
  private quoteTimer?: NodeJS.Timeout;
  private intradayTimer?: NodeJS.Timeout;
  private quoteController?: AbortController;
  private intradayController?: AbortController;
  private running = false;
  private quotePending = false;
  private intradayPending = false;
  private quoteFailures = 0;
  private intradayFailures = 0;
  private quoteError?: string;
  private intradayError?: string;
  private intradayGeneration = 0;
  private readonly intradayCache = new Map<string, IntradayPoint[]>();
  private snapshot: MarketSnapshot = { quotes: {}, intraday: [], stale: false };

  constructor(
    private readonly provider: MarketDataProvider,
    private readonly stocks: () => readonly StockRef[],
    private readonly currentCode: () => string | undefined,
    private readonly quoteIntervalSeconds: () => number,
    private readonly intradayIntervalSeconds: () => number
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.refreshNow();
  }

  stop(): void {
    this.running = false;
    if (this.quoteTimer) clearTimeout(this.quoteTimer);
    if (this.intradayTimer) clearTimeout(this.intradayTimer);
    this.quoteController?.abort();
    this.intradayController?.abort();
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
    await Promise.all([this.refreshQuotesNow(), this.refreshIntradayNow()]);
  }

  async refreshQuotesNow(): Promise<void> {
    if (this.quoteController) {
      this.quotePending = true;
      return;
    }
    if (this.quoteTimer) clearTimeout(this.quoteTimer);
    const controller = new AbortController();
    this.quoteController = controller;
    try {
      const watchlist = [...this.stocks()];
      const quotes = await this.provider.fetchQuotes(watchlist, controller.signal);
      if (this.quoteController !== controller) return;
      const quoteRecord = Object.fromEntries(quotes.map((quote) => [quote.code, quote])) as Record<string, StockQuote>;
      const current = this.currentCode();
      const currentQuote = current ? quoteRecord[current] : undefined;
      this.quoteFailures = 0;
      this.quoteError = undefined;
      this.snapshot = {
        ...this.snapshot,
        quotes: quoteRecord,
        currentCode: current,
        previousClose: currentQuote?.previousClose ?? this.snapshot.previousClose,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (!isAbort(error) && this.quoteController === controller) {
        this.quoteFailures += 1;
        this.quoteError = message(error);
      }
    } finally {
      if (this.quoteController !== controller) return;
      this.quoteController = undefined;
      this.publish();
      if (!this.running) return;
      if (this.quotePending) {
        this.quotePending = false;
        queueMicrotask(() => void this.refreshQuotesNow());
      } else {
        this.scheduleQuotes();
      }
    }
  }

  switchCurrent(): void {
    if (this.intradayTimer) clearTimeout(this.intradayTimer);
    this.intradayController?.abort();
    this.intradayController = undefined;
    this.intradayPending = false;
    this.intradayGeneration += 1;
    this.intradayFailures = 0;
    this.intradayError = undefined;

    const code = this.currentCode();
    const quote = code ? this.snapshot.quotes[code] : undefined;
    this.snapshot = {
      ...this.snapshot,
      currentCode: code,
      intraday: code ? this.intradayCache.get(code) ?? [] : [],
      previousClose: quote?.previousClose ?? undefined
    };
    this.publish();
    void this.refreshIntradayNow();
  }

  private async refreshIntradayNow(): Promise<void> {
    if (this.intradayController) {
      this.intradayPending = true;
      return;
    }
    if (this.intradayTimer) clearTimeout(this.intradayTimer);
    const stock = this.stocks().find((item) => item.code === this.currentCode());
    if (!stock) {
      this.intradayFailures = 0;
      this.intradayError = undefined;
      this.snapshot = { ...this.snapshot, currentCode: undefined, intraday: [], previousClose: undefined };
      this.publish();
      if (this.running) this.scheduleIntraday();
      return;
    }

    const controller = new AbortController();
    const generation = this.intradayGeneration;
    const requestedCode = stock.code;
    this.intradayController = controller;
    try {
      const intraday = await this.provider.fetchIntraday(stock, controller.signal);
      if (!this.isActiveIntraday(controller, generation, requestedCode)) return;
      const enriched = addVolumeRatios(intraday);
      this.intradayCache.set(requestedCode, enriched);
      this.intradayFailures = 0;
      this.intradayError = undefined;
      this.snapshot = {
        ...this.snapshot,
        currentCode: requestedCode,
        intraday: enriched,
        previousClose: this.snapshot.quotes[requestedCode]?.previousClose ?? this.snapshot.previousClose,
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      if (!isAbort(error) && this.isActiveIntraday(controller, generation, requestedCode)) {
        this.intradayFailures += 1;
        this.intradayError = message(error);
      }
    } finally {
      if (!this.isActiveIntraday(controller, generation, requestedCode)) return;
      this.intradayController = undefined;
      this.publish();
      if (!this.running) return;
      if (this.intradayPending) {
        this.intradayPending = false;
        queueMicrotask(() => void this.refreshIntradayNow());
      } else {
        this.scheduleIntraday();
      }
    }
  }

  private isActiveIntraday(controller: AbortController, generation: number, code: string): boolean {
    return this.intradayController === controller
      && this.intradayGeneration === generation
      && this.currentCode() === code;
  }

  private publish(): void {
    const errors = [this.quoteError, this.intradayError].filter((value): value is string => Boolean(value));
    this.snapshot = {
      ...this.snapshot,
      stale: errors.length > 0,
      error: errors.length ? errors.join('; ') : undefined
    };
    this.events.emit('snapshot', this.snapshot);
  }

  private scheduleQuotes(): void {
    const configured = Math.max(1, Math.min(60, this.quoteIntervalSeconds()));
    const seconds = this.quoteFailures === 0
      ? configured
      : BACKOFF_SECONDS[Math.min(this.quoteFailures - 1, BACKOFF_SECONDS.length - 1)];
    this.quoteTimer = setTimeout(() => void this.refreshQuotesNow(), seconds * 1000);
  }

  private scheduleIntraday(): void {
    const configured = Math.max(3, Math.min(60, this.intradayIntervalSeconds()));
    const seconds = this.intradayFailures === 0
      ? configured
      : BACKOFF_SECONDS[Math.min(this.intradayFailures - 1, BACKOFF_SECONDS.length - 1)];
    this.intradayTimer = setTimeout(() => void this.refreshIntradayNow(), seconds * 1000);
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
