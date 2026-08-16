export interface PriceSegment {
  fromPosition: number;
  toPosition: number;
  fromPrice: number;
  toPrice: number;
  direction: 'up' | 'down' | 'flat';
}

export interface ChartLayout {
  chartWidth: number;
  scaleLeft: number;
  scaleRight: number;
  showScale: boolean;
}

export function chartLayout(width: number, minimapLeft?: number): ChartLayout {
  const safeWidth = Math.max(1, width);
  const hasMinimap = Number.isFinite(minimapLeft) && minimapLeft! > 160 && minimapLeft! < safeWidth;
  const scaleRight = Math.max(1, (hasMinimap ? minimapLeft! : safeWidth) - 6);
  const showScale = scaleRight >= 460;
  const fallbackReserve = safeWidth >= 700 ? 104 : 56;
  const chartWidth = Math.max(1, showScale ? scaleRight - 112 : safeWidth - fallbackReserve);
  return { chartWidth, scaleLeft: chartWidth + 8, scaleRight, showScale };
}

export function symmetricPriceRange(prices: number[], previousClose: number): { min: number; max: number } {
  const valid = prices.filter(Number.isFinite);
  const delta = Math.max(
    ...valid.map((price) => Math.abs(price - previousClose)),
    Math.abs(previousClose) * 0.005,
    0.01
  );
  return { min: previousClose - delta * 1.08, max: previousClose + delta * 1.08 };
}

export function tradingSessionProgress(time: string): number | undefined {
  const match = time.match(/(?:\d{4}-\d{2}-\d{2}\s+)?(\d{1,2}):(\d{2})/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;
  const total = hour * 60 + minute;
  const morningStart = 9 * 60 + 30;
  const morningEnd = 11 * 60 + 30;
  const afternoonStart = 13 * 60;
  const afternoonEnd = 15 * 60;
  if (total <= morningStart) return 0;
  if (total <= morningEnd) return (total - morningStart) / 240;
  if (total < afternoonStart) return 0.5;
  if (total <= afternoonEnd) return (120 + total - afternoonStart) / 240;
  return 1;
}

export function splitPriceSegments(prices: number[], positions: number[], previousClose: number): PriceSegment[] {
  const segments: PriceSegment[] = [];
  for (let index = 1; index < prices.length; index += 1) {
    const fromPrice = prices[index - 1];
    const toPrice = prices[index];
    const fromPosition = positions[index - 1];
    const toPosition = positions[index];
    if (![fromPrice, toPrice, fromPosition, toPosition].every(Number.isFinite)) continue;
    const fromDelta = fromPrice - previousClose;
    const toDelta = toPrice - previousClose;
    if (fromDelta * toDelta < 0) {
      const ratio = Math.abs(fromDelta) / (Math.abs(fromDelta) + Math.abs(toDelta));
      const crossing = fromPosition + (toPosition - fromPosition) * ratio;
      segments.push({
        fromPosition,
        toPosition: crossing,
        fromPrice,
        toPrice: previousClose,
        direction: direction(fromDelta)
      });
      segments.push({
        fromPosition: crossing,
        toPosition,
        fromPrice: previousClose,
        toPrice,
        direction: direction(toDelta)
      });
    } else {
      segments.push({
        fromPosition,
        toPosition,
        fromPrice,
        toPrice,
        direction: direction(fromDelta || toDelta)
      });
    }
  }
  return segments;
}

export function formatChangePercent(price: number, previousClose: number): string {
  if (!Number.isFinite(price) || !Number.isFinite(previousClose) || previousClose === 0) return '--';
  const percent = (price - previousClose) / previousClose * 100;
  const prefix = percent > 0 ? '+' : '';
  return `${prefix}${percent.toFixed(2)}%`;
}

export function formatPriceScaleLabel(price: number, previousClose: number): string {
  if (!Number.isFinite(price)) return '--';
  return `${price.toFixed(2)}  ${formatChangePercent(price, previousClose)}`;
}

function direction(delta: number): PriceSegment['direction'] {
  return delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
}
