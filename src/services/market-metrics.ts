import type { IntradayPoint, StockQuote, WatchlistEntry } from '../domain/types';

export function addVolumeRatios(points: IntradayPoint[]): IntradayPoint[] {
  const history: number[] = [];
  return points.map((point) => {
    const valid = Number.isFinite(point.volume) && point.volume > 0;
    const average = history.length ? history.reduce((sum, value) => sum + value, 0) / history.length : undefined;
    const volumeRatio = valid && average && average > 0 ? point.volume / average : undefined;
    if (valid) {
      history.push(point.volume);
      if (history.length > 20) history.shift();
    }
    return volumeRatio === undefined ? point : { ...point, volumeRatio };
  });
}

export function groupChangePercent(entries: readonly WatchlistEntry[], quotes: Record<string, StockQuote>): number | undefined {
  let change = 0;
  let base = 0;
  for (const entry of entries) {
    const quote = quotes[entry.code];
    if (quote?.price == null || quote.previousClose == null || quote.previousClose <= 0) continue;
    change += quote.price - quote.previousClose;
    base += quote.previousClose;
  }
  return base > 0 ? change / base * 100 : undefined;
}

export function holdingProfit(entry: WatchlistEntry, quote: StockQuote | undefined): { amount?: number; percent?: number } {
  if (!quote || quote.price == null || !Number.isFinite(entry.costPrice) || !Number.isFinite(entry.shares) || entry.costPrice! <= 0 || entry.shares! <= 0) return {};
  return {
    amount: (quote.price - entry.costPrice!) * entry.shares!,
    percent: (quote.price - entry.costPrice!) / entry.costPrice! * 100
  };
}
