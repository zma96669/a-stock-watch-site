import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRetailEstimate, finiteNumber } from './retail-metrics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'website', 'data', 'retail');
const configPath = path.join(dataDir, 'stocks.json');
const outputPath = path.join(dataDir, 'index.json');
const now = new Date().toISOString();

const config = JSON.parse(await readFile(configPath, 'utf8'));
const previous = await readJson(outputPath, { schemaVersion: 1, generatedAt: undefined, symbols: [] });
const previousByCode = new Map((previous.symbols ?? []).map((symbol) => [symbol.code, symbol]));
const symbols = [];

for (const item of config.symbols ?? []) {
  const code = String(item.code).replace(/\D/g, '').padStart(6, '0');
  if (!/^\d{6}$/.test(code) || item.enabled === false) continue;
  try {
    const symbol = await collectSymbol({ ...item, code });
    symbols.push(symbol);
    console.log(`[ok] ${code} ${symbol.name}: ${symbol.holders.length} holder points, ${symbol.prices.length} price points`);
  } catch (error) {
    const old = previousByCode.get(code);
    if (old) {
      symbols.push({ ...old, sourceStatus: { ...old.sourceStatus, currentRun: 'failed', error: message(error) } });
      console.warn(`[stale] ${code}: ${message(error)}`);
    } else {
      symbols.push({
        code,
        name: item.name ?? code,
        market: item.market ?? marketFor(code),
        holders: [],
        prices: [],
        sourceStatus: { currentRun: 'failed', error: message(error) }
      });
      console.warn(`[empty] ${code}: ${message(error)}`);
    }
  }
}

const output = {
  schemaVersion: 1,
  generatedAt: now,
  methodology: {
    label: '股东户数代理值',
    formula: 'H = 股东户数；I = 可识别机构账户；C = 可识别法人账户；T = 前十大可识别非散户账户；R = max(0, H − I − C − T)；代理占比 = R / H',
    confidence: 'C（当前公开接口没有完整机构/法人账户明细，因此 R 通常等于 H；不是实际散户人数）',
    disclaimer: '一个投资者可能拥有多个证券账户，公开披露也不会完整分类账户。结果用于观察历史结构变化，不代表因果或投资建议。',
    sources: {
      holders: '东方财富 datacenter-web：RPT_F10_EH_HOLDERNUM',
      prices: '东方财富 push2his：日 K 线接口',
      quote: '东方财富 push2：最新报价接口'
    }
  },
  symbols
};
await atomicWrite(outputPath, JSON.stringify(output, null, 2) + '\n');

async function collectSymbol(item) {
  const market = item.market ?? marketFor(item.code);
  const [holdersResponse, pricesResponse, quoteResponse] = await Promise.all([
    fetchJson(holderUrl(item.code)),
    fetchJson(priceUrl(item.code)),
    fetchJson(quoteUrl(item.code))
  ]);
  const holderRows = Array.isArray(holdersResponse?.result?.data) ? holdersResponse.result.data : [];
  if (!holderRows.length) throw new Error('股东户数接口没有返回记录');
  const quote = quoteResponse?.data ?? {};
  const holders = holderRows
    .map((row) => {
      const shareholderAccounts = finiteNumber(row.HOLDER_TOTAL_NUM ?? row.HOLDER_A_NUM);
      const estimate = buildRetailEstimate({
        shareholderAccounts,
        identifiableInstitutionAccounts: finiteNumber(item.identifiableInstitutionAccounts) ?? 0,
        identifiableCorporateAccounts: finiteNumber(item.identifiableCorporateAccounts) ?? 0,
        top10NonRetailAccounts: finiteNumber(item.top10NonRetailAccounts) ?? 0
      });
      if (!estimate) return undefined;
      return {
        asOf: normalizeDate(row.END_DATE),
        noticeDate: normalizeDate(row.NOTICE_DATE),
        ...estimate,
        averageFreeShares: finiteNumber(row.AVG_FREE_SHARES ?? row.AVG_FREE_A_SHARES),
        averageHoldAmount: finiteNumber(row.AVG_HOLD_AMT),
        concentration: row.HOLD_FOCUS ?? undefined,
        source: 'eastmoney',
        sourceUrl: holderUrl(item.code)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.asOf.localeCompare(b.asOf));
  if (!holders.length) throw new Error('股东户数记录字段无效');
  const prices = parseKlines(pricesResponse?.data?.klines);
  return {
    code: item.code,
    name: quote.f58 ?? item.name ?? holdersResponse.result.data[0].SECURITY_NAME_ABBR ?? item.code,
    market,
    latestQuote: {
      price: finiteNumber(quote.f43) !== undefined ? Number(quote.f43) / 100 : undefined,
      previousClose: finiteNumber(quote.f60) !== undefined ? Number(quote.f60) / 100 : undefined,
      changePercent: finiteNumber(quote.f170) !== undefined ? Number(quote.f170) / 100 : undefined,
      turnoverRate: finiteNumber(quote.f168) !== undefined ? Number(quote.f168) / 100 : undefined,
      amount: finiteNumber(quote.f48)
    },
    holders,
    prices,
    sourceStatus: {
      currentRun: 'ok',
      holders: '东方财富公开股东户数报表',
      prices: '东方财富公开日 K 线接口',
      quote: '东方财富公开报价接口',
      holdersUrl: holderUrl(item.code),
      pricesUrl: priceUrl(item.code),
      quoteUrl: quoteUrl(item.code),
      fetchedAt: now
    }
  };
}

function parseKlines(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const fields = String(row).split(',');
    return {
      date: fields[0],
      open: number(fields[1]),
      close: number(fields[2]),
      high: number(fields[3]),
      low: number(fields[4]),
      volume: number(fields[5]),
      amount: number(fields[6]),
      changePercent: number(fields[8]),
      turnoverRate: number(fields[10])
    };
  }).filter((point) => point.date && point.close !== undefined);
}

async function fetchJson(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json,text/plain,*/*',
          referer: 'https://quote.eastmoney.com/',
          'user-agent': 'a-stock-watch-retail-collector/1.0'
        },
        signal: AbortSignal.timeout(15000)
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

function holderUrl(code) {
  const filter = encodeURIComponent(`(SECURITY_CODE="${code}")`);
  return `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_EH_HOLDERNUM&columns=ALL&filter=${filter}&pageNumber=1&pageSize=100&sortColumns=END_DATE&sortTypes=-1`;
}

function priceUrl(code) {
  const begin = new Date();
  begin.setFullYear(begin.getFullYear() - 3);
  const beg = `${begin.getFullYear()}${String(begin.getMonth() + 1).padStart(2, '0')}${String(begin.getDate()).padStart(2, '0')}`;
  return `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${marketFor(code) === 'SH' ? '1' : '0'}.${code}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&beg=${beg}&end=20500101`;
}

function quoteUrl(code) {
  return `https://push2.eastmoney.com/api/qt/stock/get?secid=${marketFor(code) === 'SH' ? '1' : '0'}.${code}&fields=f43,f48,f58,f60,f168,f170`;
}

function marketFor(code) { return code.startsWith('6') ? 'SH' : 'SZ'; }
function normalizeDate(value) { return String(value ?? '').slice(0, 10); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function message(error) { return error instanceof Error ? error.message : String(error); }
async function readJson(file, fallback) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } }
async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, content, 'utf8');
  await rename(temp, file);
}
