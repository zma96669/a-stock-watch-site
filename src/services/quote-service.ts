import { EventEmitter } from 'node:events';
import type { IntradayPoint, MarketDataProvider, MarketSnapshot, StockQuote, StockRef } from '../domain/types';
import { instrumentKey, marketIndex, MARKET_INDICES } from '../market/market-indices';
import { addVolumeRatios } from './market-metrics';

const BACKOFF_SECONDS = [5, 10, 20, 30];

export class QuoteService {
  private readonly events = new EventEmitter();
  private quoteTimer?: NodeJS.Timeout;
  private intradayTimer?: NodeJS.Timeout;
  private indexTimer?: NodeJS.Timeout;
  private quoteController?: AbortController;
  private intradayController?: AbortController;
  private indexController?: AbortController;
  private running = false;
  private quotePending = false;
  private intradayPending = false;
  private indexPending = false;
  private quoteFailures = 0;
  private intradayFailures = 0;
  private indexFailures = 0;
  private quoteError?: string;
  private intradayError?: string;
  private indexError?: string;
  private intradayGeneration = 0;
  private readonly intradayCache = new Map<string, IntradayPoint[]>();
  private currentIndexKey?: string;
  private snapshot: MarketSnapshot = { quotes: {}, indexQuotes: {}, indexIntraday: {}, intraday: [], stale: false };

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
    if (this.indexTimer) clearTimeout(this.indexTimer);
    this.quoteController?.abort();
    this.intradayController?.abort();
    this.indexController?.abort();
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
    await Promise.all([this.refreshQuotesNow(), this.refreshIntradayNow(), this.refreshIndicesNow()]);
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
      const instruments = uniqueInstruments([...watchlist, ...MARKET_INDICES]);
      const quotes = await this.provider.fetchQuotes(instruments, controller.signal);
      if (this.quoteController !== controller) return;
      const quoteRecord = Object.fromEntries(quotes.filter((quote) => quote.kind !== 'index').map((quote) => [quote.code, quote])) as Record<string, StockQuote>;
      const indexQuotes = Object.fromEntries(MARKET_INDICES.flatMap((index) => {
        const quote = quotes.find((row) => instrumentKey(row) === instrumentKey(index));
        return quote ? [[index.key, quote] as const] : [];
      })) as Record<string, StockQuote>;
      const current = this.currentCode();
      const activeQuote = this.currentIndexKey ? indexQuotes[this.currentIndexKey] : current ? quoteRecord[current] : undefined;
      this.quoteFailures = 0;
      this.quoteError = undefined;
      this.snapshot = {
        ...this.snapshot,
        quotes: quoteRecord,
        indexQuotes,
        currentCode: current,
        currentIndexKey: this.currentIndexKey,
        activeQuote,
        previousClose: activeQuote?.previousClose ?? this.snapshot.previousClose,
        updatedAt: new Date().toISOString(),
        quoteUpdatedAt: new Date().toISOString(),
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
    const index = marketIndex(this.currentIndexKey);
    const quote = index ? this.snapshot.indexQuotes[index.key] : code ? this.snapshot.quotes[code] : undefined;
    const cacheKey = index ? index.key : code;
    this.snapshot = {
      ...this.snapshot,
      currentCode: code,
      currentIndexKey: index?.key,
      activeQuote: quote,
      intraday: cacheKey ? this.intradayCache.get(cacheKey) ?? [] : [],
      previousClose: quote?.previousClose ?? undefined
    };
    this.publish();
    void this.refreshIntradayNow();
  }

  selectIndex(key: string): void {
    if (!marketIndex(key) || this.currentIndexKey === key) return;
    this.currentIndexKey = key;
    this.switchCurrent();
  }

  selectStock(): void {
    const current = this.currentCode();
    if (!this.currentIndexKey && this.snapshot.currentCode === current) return;
    this.currentIndexKey = undefined;
    this.switchCurrent();
  }

  private async refreshIntradayNow(): Promise<void> {
    if (this.intradayController) {
      this.intradayPending = true;
      return;
    }
    if (this.intradayTimer) clearTimeout(this.intradayTimer);
    const selectedIndex = marketIndex(this.currentIndexKey);
    if (selectedIndex) {
      const quote = this.snapshot.indexQuotes[selectedIndex.key];
      this.intradayFailures = 0;
      this.intradayError = undefined;
      this.snapshot = {
        ...this.snapshot,
        currentCode: this.currentCode(),
        currentIndexKey: selectedIndex.key,
        activeQuote: quote,
        intraday: this.intradayCache.get(selectedIndex.key) ?? [],
        previousClose: quote?.previousClose ?? this.snapshot.previousClose
      };
      this.publish();
      if (this.running) this.scheduleIntraday();
      return;
    }
    const stock = this.stocks().find((item) => item.code === this.currentCode());
    if (!stock) {
      this.intradayFailures = 0;
      this.intradayError = undefined;
      this.snapshot = { ...this.snapshot, currentCode: undefined, currentIndexKey: undefined, activeQuote: undefined, intraday: [], previousClose: undefined };
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
        currentIndexKey: undefined,
        activeQuote: this.snapshot.quotes[requestedCode],
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
      && !this.currentIndexKey
      && this.currentCode() === code;
  }

  private async refreshIndicesNow(): Promise<void> {
    if (this.indexController) {
      this.indexPending = true;
      return;
    }
    if (this.indexTimer) clearTimeout(this.indexTimer);
    const controller = new AbortController();
    this.indexController = controller;
    try {
      const results = await Promise.allSettled(MARKET_INDICES.map((index) => this.provider.fetchIntraday(index, controller.signal)));
      if (this.indexController !== controller || controller.signal.aborted) return;
      const indexIntraday = { ...this.snapshot.indexIntraday };
      const errors: string[] = [];
      results.forEach((result, index) => {
        const definition = MARKET_INDICES[index];
        if (result.status === 'fulfilled' && result.value.length) {
          const enriched = addVolumeRatios(result.value);
          this.intradayCache.set(definition.key, enriched);
          indexIntraday[definition.key] = enriched;
        } else if (result.status === 'rejected' && !isAbort(result.reason)) {
          errors.push(`${definition.name}: ${message(result.reason)}`);
        } else if (result.status === 'fulfilled') {
          errors.push(`${definition.name}: empty intraday response`);
        }
      });
      this.indexFailures = errors.length ? this.indexFailures + 1 : 0;
      this.indexError = errors.length ? errors.join('; ') : undefined;
      const selected = marketIndex(this.currentIndexKey);
      const selectedPoints = selected ? indexIntraday[selected.key] : undefined;
      const selectedQuote = selected ? this.snapshot.indexQuotes[selected.key] : undefined;
      this.snapshot = {
        ...this.snapshot,
        indexIntraday,
        ...(selected ? {
          currentIndexKey: selected.key,
          activeQuote: selectedQuote,
          intraday: selectedPoints ?? this.snapshot.intraday,
          previousClose: selectedQuote?.previousClose ?? this.snapshot.previousClose
        } : {}),
        updatedAt: new Date().toISOString()
      };
    } finally {
      if (this.indexController !== controller) return;
      this.indexController = undefined;
      this.publish();
      if (!this.running) return;
      if (this.indexPending) {
        this.indexPending = false;
        queueMicrotask(() => void this.refreshIndicesNow());
      } else {
        this.scheduleIndices();
      }
    }
  }

  private publish(): void {
    const errors = [this.quoteError, this.intradayError, this.indexError].filter((value): value is string => Boolean(value));
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

  private scheduleIndices(): void {
    const configured = Math.max(3, Math.min(60, this.intradayIntervalSeconds()));
    const seconds = this.indexFailures === 0
      ? configured
      : BACKOFF_SECONDS[Math.min(this.indexFailures - 1, BACKOFF_SECONDS.length - 1)];
    this.indexTimer = setTimeout(() => void this.refreshIndicesNow(), seconds * 1000);
  }
}

function uniqueInstruments(instruments: readonly StockRef[]): StockRef[] {
  return [...new Map(instruments.map((instrument) => [instrumentKey(instrument), instrument])).values()];
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
