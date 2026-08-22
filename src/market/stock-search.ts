import { createStockRef } from './stock-code';
import type { StockRef } from '../domain/types';

const SEARCH_URL = 'https://searchapi.eastmoney.com/api/suggest/get';

interface SearchRow {
  Code?: unknown;
  Name?: unknown;
  MktNum?: unknown;
  SecurityTypeName?: unknown;
  QuoteID?: unknown;
}

export function parseStockSearchResponse(payload: unknown): StockRef[] {
  const table = (payload as { QuotationCodeTable?: { Data?: unknown[] } } | null)?.QuotationCodeTable;
  const rows = table?.Data;
  if (!Array.isArray(rows)) return [];
  const result: StockRef[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as SearchRow;
    const code = String(row.Code ?? '').trim();
    const name = String(row.Name ?? '').trim();
    if (!/^\d{6}$/.test(code) || !name || seen.has(code)) continue;
    try {
      const stock = createStockRef(code, name);
      if (!isAshare(row, stock)) continue;
      result.push(stock);
      seen.add(code);
    } catch { /* filter non A-share securities */ }
  }
  return result;
}

export async function searchStocks(query: string, signal?: AbortSignal): Promise<StockRef[]> {
  const input = query.trim();
  if (!input) return [];
  const url = new URL(SEARCH_URL);
  url.searchParams.set('input', input);
  url.searchParams.set('type', '14');
  url.searchParams.set('token', '11111111');
  url.searchParams.set('count', '20');
  try {
    const response = await fetch(url, {
      signal,
      headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': 'AStockWatch-VSCode/0.1' }
    });
    if (!response.ok) throw new Error(`股票搜索服务返回 HTTP ${response.status}`);
    const rows = parseStockSearchResponse(await response.json());
    if (rows.length || !/^\d{6}$/.test(input)) return rows;
  } catch (error) {
    if (!/^\d{6}$/.test(input)) throw error;
  }
  try { return [createStockRef(input)]; } catch { return []; }
}

function isAshare(row: SearchRow, stock: StockRef): boolean {
  const type = `${String(row.SecurityTypeName ?? '')} ${String(row.QuoteID ?? '')}`.toLowerCase();
  if (/港|美|基金|债|指数|期|etf|hk|us/.test(type)) return false;
  const market = String(row.MktNum ?? '');
  return !market || market === '0' || market === '1' || stock.market === 'SH' || stock.market === 'SZ';
}
