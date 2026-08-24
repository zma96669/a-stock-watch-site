import type { IntradayPoint, MarketDataProvider, StockQuote, StockRef } from '../domain/types';

const QUOTE_FIELDS = 'f12,f13,f14,f2,f3,f4,f5,f6,f8,f17,f18';
const TREND_FIELDS_1 = 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13';
const TREND_FIELDS_2 = 'f51,f52,f53,f54,f55,f56,f57,f58';

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '-' || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseQuoteResponse(payload: unknown, requested: StockRef[]): StockQuote[] {
  const rows = (payload as { data?: { diff?: unknown[] } } | null)?.data?.diff;
  if (!Array.isArray(rows)) return [];
  const requestedBySecid = new Map(requested.map((stock) => [stock.secid, stock]));
  const requestedByCode = new Map<string, StockRef[]>();
  requested.forEach((stock) => requestedByCode.set(stock.code, [...requestedByCode.get(stock.code) ?? [], stock]));
  return rows.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const code = String(row.f12 ?? '');
    const market = finiteNumber(row.f13);
    const stock = (market !== null ? requestedBySecid.get(`${market}.${code}`) : undefined)
      ?? (requestedByCode.get(code)?.length === 1 ? requestedByCode.get(code)![0] : undefined);
    if (!stock) return [];
    const price = finiteNumber(row.f2);
    const previousClose = finiteNumber(row.f18);
    const change = finiteNumber(row.f4);
    const changePercent = finiteNumber(row.f3);
    return [{
      ...stock,
      name: String(row.f14 ?? stock.name ?? code),
      price,
      previousClose,
      change,
      changePercent,
      volume: finiteNumber(row.f5),
      amount: finiteNumber(row.f6),
      turnoverRate: finiteNumber(row.f8),
      suspended: price === null || price === 0
    }];
  });
}

export function parseTrendResponse(payload: unknown, stock?: StockRef): IntradayPoint[] {
  const trends = (payload as { data?: { trends?: unknown[] } } | null)?.data?.trends;
  if (!Array.isArray(trends)) return [];
  const points: IntradayPoint[] = [];
  for (const raw of trends) {
    if (typeof raw !== 'string') continue;
    const fields = raw.split(',');
    // trends2 fields: time, open, close, high, low, volume, amount, average.
    const price = finiteNumber(fields[2]);
    const averagePrice = stock?.kind === 'index' ? price : finiteNumber(fields[7]);
    const volume = finiteNumber(fields[5]);
    const amount = finiteNumber(fields[6]);
    if (!fields[0] || price === null || averagePrice === null) continue;
    points.push({
      time: fields[0],
      price,
      averagePrice,
      volume: volume ?? 0,
      amount: amount ?? 0
    });
  }
  return points;
}

async function fetchJson(url: URL, signal?: AbortSignal): Promise<unknown> {
  const ownController = new AbortController();
  const timeout = setTimeout(() => ownController.abort(), 5000);
  const abort = () => ownController.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, {
      signal: ownController.signal,
      headers: {
        Referer: 'https://quote.eastmoney.com/',
        'User-Agent': 'AStockWatch-VSCode/0.1'
      }
    });
    if (!response.ok) throw new Error(`行情服务返回 HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export class EastMoneyProvider implements MarketDataProvider {
  async fetchQuotes(stocks: StockRef[], signal?: AbortSignal): Promise<StockQuote[]> {
    if (stocks.length === 0) return [];
    const url = new URL('https://push2.eastmoney.com/api/qt/ulist.np/get');
    url.searchParams.set('secids', stocks.map((stock) => stock.secid).join(','));
    url.searchParams.set('fields', QUOTE_FIELDS);
    url.searchParams.set('fltt', '2');
    url.searchParams.set('invt', '2');
    return parseQuoteResponse(await fetchJson(url, signal), stocks);
  }

  async fetchIntraday(stock: StockRef, signal?: AbortSignal): Promise<IntradayPoint[]> {
    const url = new URL('https://push2his.eastmoney.com/api/qt/stock/trends2/get');
    url.searchParams.set('secid', stock.secid);
    url.searchParams.set('fields1', TREND_FIELDS_1);
    url.searchParams.set('fields2', TREND_FIELDS_2);
    url.searchParams.set('ndays', '1');
    url.searchParams.set('iscr', '0');
    return parseTrendResponse(await fetchJson(url, signal), stock);
  }
}
