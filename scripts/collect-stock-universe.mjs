import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'website', 'data', 'retail', 'universe.json');
const now = new Date().toISOString();
const endpoint = 'https://push2.eastmoney.com/api/qt/clist/get?pn={page}&pz=100&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f12,f14,f13,f2,f3,f5,f6,f18';

try {
  const firstPage = await fetchJson(pageUrl(1));
  const total = Number(firstPage?.data?.total) || 0;
  const pageSize = 100;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pages = [firstPage];
  // The endpoint advertises the full total but caps every response at 100
  // rows, so explicitly walk all pages. Small batches keep the public API
  // responsive and make a partial failure retryable.
  for (let start = 2; start <= pageCount; start += 8) {
    const batch = await Promise.all(Array.from({ length: Math.min(8, pageCount - start + 1) }, (_, index) => fetchJson(pageUrl(start + index))));
    pages.push(...batch);
  }
  const rows = pages.flatMap((payload) => Object.values(payload?.data?.diff ?? {}));
  const stocks = rows.map(normalize).filter(Boolean).sort((a, b) => a.code.localeCompare(b.code));
  if (!stocks.length) throw new Error('全市场目录接口没有返回股票');
  await atomicWrite(outputPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: now,
    total: stocks.length,
    source: 'eastmoney',
    sourceUrl: pageUrl(1),
    disclaimer: '目录用于名称/代码搜索；趋势数据是否已采集以 dataReady 字段为准。',
    stocks
  }, null, 2) + '\n');
  console.log(`[ok] stock universe: ${stocks.length} A-share entries`);
} catch (error) {
  const previous = await readJson(outputPath);
  if (previous?.stocks?.length) {
    console.warn(`[stale] stock universe: ${message(error)}; kept ${previous.stocks.length} entries`);
  } else {
    throw error;
  }
}

function normalize(row) {
  const code = String(row.f12 ?? '').replace(/\D/g, '').padStart(6, '0');
  const name = String(row.f14 ?? '').replace(/\s+/g, ' ').trim();
  if (!/^\d{6}$/.test(code) || !name) return undefined;
  return {
    code,
    name,
    market: Number(row.f13) === 1 ? 'SH' : 'SZ',
    latestQuote: {
      price: scaled(row.f2, 100),
      changePercent: scaled(row.f3, 100),
      volume: nonNegative(row.f5),
      amount: nonNegative(row.f6),
      previousClose: scaled(row.f18, 100)
    },
    dataReady: false
  };
}

function pageUrl(page) { return endpoint.replace('{page}', String(page)); }

async function fetchJson(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json,text/plain,*/*',
          referer: 'https://quote.eastmoney.com/',
          'user-agent': 'a-stock-watch-universe-collector/1.0'
        },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error('请求失败');
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nonNegative(value) {
  const parsed = number(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function scaled(value, divisor) {
  const parsed = number(value);
  return parsed === undefined || parsed === 0 ? (parsed === 0 ? 0 : undefined) : parsed / divisor;
}

function message(error) { return error instanceof Error ? error.message : String(error); }
async function readJson(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return undefined; } }
async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, content, 'utf8');
  await rename(temp, file);
}
