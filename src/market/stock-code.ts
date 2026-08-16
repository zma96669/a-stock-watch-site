import type { StockMarket, StockRef } from '../domain/types';

const SH_PREFIXES = ['60', '68'];
const SZ_PREFIXES = ['00', '30'];

export function normalizeStockCode(input: string): string {
  const code = input.trim().replace(/^(sh|sz)/i, '');
  if (!/^\d{6}$/.test(code)) {
    throw new Error('请输入六位 A 股代码，例如 600519');
  }
  return code;
}

export function inferMarket(codeInput: string): StockMarket {
  const code = normalizeStockCode(codeInput);
  if (SH_PREFIXES.some((prefix) => code.startsWith(prefix))) return 'SH';
  if (SZ_PREFIXES.some((prefix) => code.startsWith(prefix))) return 'SZ';
  throw new Error(`暂不支持股票代码 ${code}，首版仅支持沪深 A 股`);
}

export function toSecid(codeInput: string): string {
  const code = normalizeStockCode(codeInput);
  return `${inferMarket(code) === 'SH' ? '1' : '0'}.${code}`;
}

export function createStockRef(codeInput: string, name = ''): StockRef {
  const code = normalizeStockCode(codeInput);
  const market = inferMarket(code);
  return { code, market, secid: `${market === 'SH' ? '1' : '0'}.${code}`, name };
}

