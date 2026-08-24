import type { AlertRule } from '../domain/types';
import type { ImportResult } from './portable-watchlist';

export interface ImportState extends ImportResult {}

export interface ImportWriters {
  replaceWatchlist: (watchlist: ImportResult['watchlist']) => Promise<void>;
  setCurrentCode: (code: string | undefined) => Promise<void>;
  replaceAlerts?: (rules: readonly AlertRule[]) => Promise<void>;
}

export async function applyImportTransaction(next: ImportResult, before: ImportState, writers: ImportWriters): Promise<void> {
  try {
    await writers.replaceWatchlist(next.watchlist);
    await writers.setCurrentCode(next.currentCode);
    if (writers.replaceAlerts && next.alerts) await writers.replaceAlerts(next.alerts);
  } catch (error) {
    try {
      await writers.replaceWatchlist(before.watchlist);
      await writers.setCurrentCode(before.currentCode);
      if (writers.replaceAlerts && before.alerts) await writers.replaceAlerts(before.alerts);
    } catch (rollbackError) {
      throw new Error(`导入失败且自动回滚失败：${errorMessage(error)}；回滚错误：${errorMessage(rollbackError)}`);
    }
    throw new Error(`导入失败，已恢复原数据：${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
