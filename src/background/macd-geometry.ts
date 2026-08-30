export interface MacdValue {
  dif: number;
  dea: number;
  histogram: number;
}

/**
 * Calculates the standard MACD series for a sequence of prices.
 * The histogram follows the convention used by most A-share terminals:
 * 2 × (DIF - DEA).
 */
export function macdSeries(
  prices: readonly number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): Array<MacdValue | undefined> {
  if (!validPeriod(fastPeriod) || !validPeriod(slowPeriod) || !validPeriod(signalPeriod) || fastPeriod >= slowPeriod) return [];

  const fastAlpha = 2 / (fastPeriod + 1);
  const slowAlpha = 2 / (slowPeriod + 1);
  const signalAlpha = 2 / (signalPeriod + 1);
  let fastEma: number | undefined;
  let slowEma: number | undefined;
  let dea: number | undefined;

  return prices.map((price) => {
    if (!Number.isFinite(price)) return undefined;
    fastEma = fastEma === undefined ? price : fastEma + fastAlpha * (price - fastEma);
    slowEma = slowEma === undefined ? price : slowEma + slowAlpha * (price - slowEma);
    const dif = fastEma - slowEma;
    dea = dea === undefined ? dif : dea + signalAlpha * (dif - dea);
    return { dif, dea, histogram: 2 * (dif - dea) };
  });
}

export function macdScale(values: readonly (MacdValue | undefined)[]): number {
  const maximum = values.reduce((current, value) => {
    if (!value) return current;
    return Math.max(current, Math.abs(value.dif), Math.abs(value.dea), Math.abs(value.histogram));
  }, 0);
  return maximum > 0 && Number.isFinite(maximum) ? maximum : 0;
}

function validPeriod(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 500;
}
