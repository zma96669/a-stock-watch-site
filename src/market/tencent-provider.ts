import type { IntradayPoint, MarketDataProvider, StockQuote, StockRef } from '../domain/types';

const QUOTE_URL = 'https://qt.gtimg.cn/q=';
const MINUTE_URL = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=';

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function symbol(stock: StockRef): string {
  return `${stock.market.toLowerCase()}${stock.code}`;
}

export function parseTencentQuoteResponse(payload: string, requested: StockRef[]): StockQuote[] {
  const requestedBySymbol = new Map(requested.map((stock) => [symbol(stock), stock]));
  const rows: StockQuote[] = [];
  const pattern = /v_(sh|sz)(\d{6})="([^"]*)"/g;
  for (const match of payload.matchAll(pattern)) {
    const stock = requestedBySymbol.get(`${match[1]}${match[2]}`);
    if (!stock) continue;
    const fields = match[3].split('~');
    const price = finiteNumber(fields[3]);
    const previousClose = finiteNumber(fields[4]);
    const amount = parseTotalAmount(fields);
    const turnoverRate = finiteNumber(fields[38]);
    rows.push({
      ...stock,
      name: fields[1] || stock.name,
      price,
      previousClose,
      change: finiteNumber(fields[31]),
      changePercent: finiteNumber(fields[32]),
      volume: finiteNumber(fields[36]),
      amount,
      turnoverRate,
      suspended: price === null || price === 0
    });
  }
  return rows;
}

function parseTotalAmount(fields: string[]): number | null {
  const summaryAmount = finiteNumber(fields[35]?.split('/')[2]);
  if (summaryAmount !== null) return summaryAmount;
  const tenThousandAmount = finiteNumber(fields[37]);
  return tenThousandAmount === null ? null : tenThousandAmount * 10_000;
}

interface TencentMinutePayload {
  data?: Record<string, { data?: { date?: string; data?: unknown[] } }>;
}

export function parseTencentMinuteResponse(payload: unknown, stock: StockRef): IntradayPoint[] {
  const block = (payload as TencentMinutePayload | null)?.data?.[symbol(stock)];
  const date = block?.data?.date;
  const rows = block?.data?.data;
  if (!/^\d{8}$/.test(date ?? '') || !Array.isArray(rows)) return [];
  const tradingDate = date!;

  const points: IntradayPoint[] = [];
  let previousVolume: number | undefined;
  let previousAmount: number | undefined;
  for (const raw of rows) {
    if (typeof raw !== 'string') continue;
    const fields = raw.trim().split(/\s+/);
    const clock = fields[0] ?? '';
    const minutes = parseClock(clock);
    if (minutes === null) continue;
    if (minutes > 15 * 60) break;
    if (!isTradingMinute(minutes)) continue;
    const price = finiteNumber(fields[1]);
    const cumulativeVolume = finiteNumber(fields[2]);
    const cumulativeAmount = finiteNumber(fields[3]);
    if (price === null || cumulativeVolume === null || cumulativeAmount === null || cumulativeVolume < 0 || cumulativeAmount < 0) return [];
    if (previousVolume !== undefined && (cumulativeVolume < previousVolume || cumulativeAmount < (previousAmount ?? 0))) return [];
    const volume = cumulativeVolume - (previousVolume ?? 0);
    const amount = cumulativeAmount - (previousAmount ?? 0);
    const averagePrice = stock.kind === 'index'
      ? price
      : cumulativeVolume > 0 ? cumulativeAmount / (cumulativeVolume * 100) : price;
    points.push({
      time: `${tradingDate.slice(0, 4)}-${tradingDate.slice(4, 6)}-${tradingDate.slice(6, 8)} ${clock.slice(0, 2)}:${clock.slice(2)}`,
      price,
      averagePrice,
      volume,
      amount
    });
    previousVolume = cumulativeVolume;
    previousAmount = cumulativeAmount;
  }
  return points;
}

function parseClock(value: string): number | null {
  if (!/^\d{4}$/.test(value)) return null;
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(2));
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

function isTradingMinute(minutes: number): boolean {
  return (minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30)
    || (minutes >= 13 * 60 && minutes <= 15 * 60);
}

async function fetchArrayBuffer(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const ownController = new AbortController();
  const timeout = setTimeout(() => ownController.abort(), 5000);
  const abort = () => ownController.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, {
      signal: ownController.signal,
      headers: { Referer: 'https://gu.qq.com/', 'User-Agent': 'AStockWatch-VSCode/0.1' }
    });
    if (!response.ok) throw new Error(`Tencent quote HTTP ${response.status}`);
    return await response.arrayBuffer();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const bytes = await fetchArrayBuffer(url, signal);
  return JSON.parse(new TextDecoder('utf-8').decode(bytes));
}

export class TencentProvider implements MarketDataProvider {
  async fetchQuotes(stocks: StockRef[], signal?: AbortSignal): Promise<StockQuote[]> {
    if (!stocks.length) return [];
    const bytes = await fetchArrayBuffer(`${QUOTE_URL}${stocks.map(symbol).join(',')}`, signal);
    return parseTencentQuoteResponse(new TextDecoder('gbk').decode(bytes), stocks);
  }

  async fetchIntraday(stock: StockRef, signal?: AbortSignal): Promise<IntradayPoint[]> {
    return parseTencentMinuteResponse(await fetchJson(`${MINUTE_URL}${symbol(stock)}`, signal), stock);
  }
}
