import {
  formatChangePercent,
  splitPriceSegments,
  symmetricPriceRange,
  tradingSessionProgress
} from './chart-geometry';

interface Point { time: string; price: number; averagePrice: number; }
interface BackgroundState {
  intraday?: Point[];
  previousClose?: number;
  background?: { opacity: number; showAverage: boolean; showVolume: boolean; lineWidth: number };
}

const loaderGlobal = globalThis as typeof globalThis & { __aStockWatchBackground?: boolean };
if (!loaderGlobal.__aStockWatchBackground) {
  loaderGlobal.__aStockWatchBackground = true;
  start();
}

function start(): void {
  const token = '__TOKEN__';
  const portStart = Number('__PORT_START__');
  const portEnd = Number('__PORT_END__');
  let state: BackgroundState | undefined;
  let activePort: number | undefined;
  const canvases = new Map<HTMLElement, HTMLCanvasElement>();

  const style = document.createElement('style');
  style.textContent = '.a-stock-watch-background{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5}.monaco-editor .view-lines,.monaco-editor .margin-view-overlays{position:relative;z-index:6}';
  document.head.appendChild(style);

  async function poll(): Promise<void> {
    const ports = activePort ? [activePort] : Array.from({ length: portEnd - portStart + 1 }, (_, index) => portStart + index);
    for (const port of ports) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/${token}/state`, { cache: 'no-store' });
        if (!response.ok) continue;
        state = await response.json() as BackgroundState;
        activePort = port;
        sync();
        drawAll();
        return;
      } catch { /* probe next */ }
    }
    activePort = undefined;
  }

  function sync(): void {
    document.querySelectorAll<HTMLElement>('.monaco-editor').forEach((host) => {
      if (canvases.has(host)) return;
      const canvas = document.createElement('canvas');
      canvas.className = 'a-stock-watch-background';
      host.appendChild(canvas);
      canvases.set(host, canvas);
      new ResizeObserver(() => draw(canvas)).observe(host);
    });
    for (const [host] of canvases) if (!host.isConnected) canvases.delete(host);
  }

  function drawAll(): void { canvases.forEach(draw); }

  function draw(canvas: HTMLCanvasElement): void {
    const points = (state?.intraday ?? []).filter((point) => Number.isFinite(point.price));
    if (!points.length) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const previousClose = validPreviousClose(state?.previousClose, points);
    const values = points.flatMap((point) => [point.price, point.averagePrice]).filter(Number.isFinite);
    const range = symmetricPriceRange(values, previousClose);
    const rightReserve = rect.width >= 700 ? 104 : 56;
    const chartWidth = Math.max(1, rect.width - rightReserve);
    const options = state?.background ?? { opacity: 0.12, showAverage: true, showVolume: false, lineWidth: 1.5 };
    const baseOpacity = clamp(options.opacity, 0.05, 0.35);
    const positions = points.map((point, index) =>
      tradingSessionProgress(point.time) ?? index / Math.max(1, points.length - 1)
    );
    const x = (position: number) => clamp(position, 0, 1) * chartWidth;
    const y = (price: number) => (range.max - price) / (range.max - range.min) * rect.height;
    const zeroY = y(previousClose);
    const segments = splitPriceSegments(points.map((point) => point.price), positions, previousClose);

    drawZeroLine(ctx, chartWidth, zeroY, baseOpacity);
    drawSegmentFill(ctx, segments, x, y, zeroY, baseOpacity);
    drawPriceSegments(ctx, segments, x, y, options.lineWidth, baseOpacity);
    if (options.showAverage) drawAverage(ctx, points, positions, x, y, options.lineWidth, baseOpacity);
    drawLatest(ctx, points.at(-1)!, positions.at(-1)!, previousClose, chartWidth, rect.height, x, y, baseOpacity);
  }

  function drawZeroLine(ctx: CanvasRenderingContext2D, width: number, zeroY: number, opacity: number): void {
    ctx.save();
    ctx.globalAlpha = Math.max(0.26, opacity * 1.8);
    ctx.strokeStyle = '#a0a0a0';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(width, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = Math.max(0.42, opacity * 2.4);
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = '#b8b8b8';
    ctx.fillText('0.00%', Math.max(4, width - 38), Math.max(11, zeroY - 4));
    ctx.restore();
  }

  function drawSegmentFill(
    ctx: CanvasRenderingContext2D,
    segments: ReturnType<typeof splitPriceSegments>,
    x: (position: number) => number,
    y: (price: number) => number,
    zeroY: number,
    opacity: number
  ): void {
    ctx.save();
    ctx.globalAlpha = Math.max(0.018, opacity * 0.2);
    for (const segment of segments) {
      ctx.beginPath();
      ctx.moveTo(x(segment.fromPosition), zeroY);
      ctx.lineTo(x(segment.fromPosition), y(segment.fromPrice));
      ctx.lineTo(x(segment.toPosition), y(segment.toPrice));
      ctx.lineTo(x(segment.toPosition), zeroY);
      ctx.closePath();
      ctx.fillStyle = color(segment.direction);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPriceSegments(
    ctx: CanvasRenderingContext2D,
    segments: ReturnType<typeof splitPriceSegments>,
    x: (position: number) => number,
    y: (price: number) => number,
    width: number,
    opacity: number
  ): void {
    ctx.save();
    ctx.globalAlpha = Math.max(0.28, opacity * 2.2);
    ctx.lineWidth = width;
    for (const segment of segments) {
      ctx.beginPath();
      ctx.moveTo(x(segment.fromPosition), y(segment.fromPrice));
      ctx.lineTo(x(segment.toPosition), y(segment.toPrice));
      ctx.strokeStyle = color(segment.direction);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAverage(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    positions: number[],
    x: (position: number) => number,
    y: (price: number) => number,
    width: number,
    opacity: number
  ): void {
    ctx.save();
    ctx.globalAlpha = Math.max(0.16, opacity * 1.25);
    ctx.strokeStyle = '#d7ba7d';
    ctx.lineWidth = Math.max(1, width * 0.75);
    ctx.beginPath();
    points.forEach((point, index) => {
      const px = x(positions[index]);
      const py = y(point.averagePrice);
      if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawLatest(
    ctx: CanvasRenderingContext2D,
    point: Point,
    position: number,
    previousClose: number,
    chartWidth: number,
    height: number,
    x: (position: number) => number,
    y: (price: number) => number,
    opacity: number
  ): void {
    const direction = point.price > previousClose ? 'up' : point.price < previousClose ? 'down' : 'flat';
    const pointX = x(position);
    const pointY = y(point.price);
    const label = formatChangePercent(point.price, previousClose);
    ctx.save();
    ctx.globalAlpha = Math.max(0.55, opacity * 3.5);
    ctx.fillStyle = color(direction);
    ctx.beginPath();
    ctx.arc(pointX, pointY, 3, 0, Math.PI * 2);
    ctx.fill();
    if (chartWidth >= 180 && height >= 60) {
      ctx.font = '600 11px system-ui, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const labelX = clamp(pointX - textWidth - 13, 4, chartWidth - textWidth - 8);
      const labelY = clamp(pointY - 20, 4, height - 20);
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = '#181818';
      ctx.fillRect(labelX - 4, labelY - 1, textWidth + 8, 16);
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = color(direction);
      ctx.fillText(label, labelX, labelY + 11);
    }
    ctx.restore();
  }

  new MutationObserver(() => { sync(); drawAll(); }).observe(document.body, { childList: true, subtree: true });
  sync();
  void poll();
  setInterval(poll, 5000);
}

function validPreviousClose(previousClose: number | undefined, points: Point[]): number {
  return Number.isFinite(previousClose) && previousClose! > 0 ? previousClose! : points[0].price;
}

function color(direction: 'up' | 'down' | 'flat'): string {
  return direction === 'up' ? '#f14c4c' : direction === 'down' ? '#89d185' : '#a0a0a0';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
