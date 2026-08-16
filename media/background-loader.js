"use strict";
(() => {
  // src/background/chart-geometry.ts
  function symmetricPriceRange(prices, previousClose) {
    const valid = prices.filter(Number.isFinite);
    const delta = Math.max(
      ...valid.map((price) => Math.abs(price - previousClose)),
      Math.abs(previousClose) * 5e-3,
      0.01
    );
    return { min: previousClose - delta * 1.08, max: previousClose + delta * 1.08 };
  }
  function tradingSessionProgress(time) {
    const match = time.match(/(?:\d{4}-\d{2}-\d{2}\s+)?(\d{1,2}):(\d{2})/);
    if (!match) return void 0;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return void 0;
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
  function splitPriceSegments(prices, positions, previousClose) {
    const segments = [];
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
  function formatChangePercent(price, previousClose) {
    if (!Number.isFinite(price) || !Number.isFinite(previousClose) || previousClose === 0) return "--";
    const percent = (price - previousClose) / previousClose * 100;
    const prefix = percent > 0 ? "+" : "";
    return `${prefix}${percent.toFixed(2)}%`;
  }
  function direction(delta) {
    return delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  }

  // src/background/browser-loader.ts
  var loaderGlobal = globalThis;
  if (!loaderGlobal.__aStockWatchBackground) {
    loaderGlobal.__aStockWatchBackground = true;
    start();
  }
  function start() {
    const token = "__TOKEN__";
    const portStart = Number("__PORT_START__");
    const portEnd = Number("__PORT_END__");
    let state;
    let activePort;
    const canvases = /* @__PURE__ */ new Map();
    const style = document.createElement("style");
    style.textContent = ".a-stock-watch-background{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5}.monaco-editor .view-lines,.monaco-editor .margin-view-overlays{position:relative;z-index:6}";
    document.head.appendChild(style);
    async function poll() {
      const ports = activePort ? [activePort] : Array.from({ length: portEnd - portStart + 1 }, (_, index) => portStart + index);
      for (const port of ports) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/${token}/state`, { cache: "no-store" });
          if (!response.ok) continue;
          state = await response.json();
          activePort = port;
          sync();
          drawAll();
          return;
        } catch {
        }
      }
      activePort = void 0;
    }
    function sync() {
      document.querySelectorAll(".monaco-editor").forEach((host) => {
        if (canvases.has(host)) return;
        const canvas = document.createElement("canvas");
        canvas.className = "a-stock-watch-background";
        host.appendChild(canvas);
        canvases.set(host, canvas);
        new ResizeObserver(() => draw(canvas)).observe(host);
      });
      for (const [host] of canvases) if (!host.isConnected) canvases.delete(host);
    }
    function drawAll() {
      canvases.forEach(draw);
    }
    function draw(canvas) {
      const points = (state?.intraday ?? []).filter((point) => Number.isFinite(point.price));
      if (!points.length) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext("2d");
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
      const positions = points.map(
        (point, index) => tradingSessionProgress(point.time) ?? index / Math.max(1, points.length - 1)
      );
      const x = (position) => clamp(position, 0, 1) * chartWidth;
      const y = (price) => (range.max - price) / (range.max - range.min) * rect.height;
      const zeroY = y(previousClose);
      const segments = splitPriceSegments(points.map((point) => point.price), positions, previousClose);
      drawZeroLine(ctx, chartWidth, zeroY, baseOpacity);
      drawSegmentFill(ctx, segments, x, y, zeroY, baseOpacity);
      drawPriceSegments(ctx, segments, x, y, options.lineWidth, baseOpacity);
      if (options.showAverage) drawAverage(ctx, points, positions, x, y, options.lineWidth, baseOpacity);
      drawLatest(ctx, points.at(-1), positions.at(-1), previousClose, chartWidth, rect.height, x, y, baseOpacity);
    }
    function drawZeroLine(ctx, width, zeroY, opacity) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.26, opacity * 1.8);
      ctx.strokeStyle = "#a0a0a0";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(0, zeroY);
      ctx.lineTo(width, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = Math.max(0.42, opacity * 2.4);
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillStyle = "#b8b8b8";
      ctx.fillText("0.00%", Math.max(4, width - 38), Math.max(11, zeroY - 4));
      ctx.restore();
    }
    function drawSegmentFill(ctx, segments, x, y, zeroY, opacity) {
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
    function drawPriceSegments(ctx, segments, x, y, width, opacity) {
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
    function drawAverage(ctx, points, positions, x, y, width, opacity) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.16, opacity * 1.25);
      ctx.strokeStyle = "#d7ba7d";
      ctx.lineWidth = Math.max(1, width * 0.75);
      ctx.beginPath();
      points.forEach((point, index) => {
        const px = x(positions[index]);
        const py = y(point.averagePrice);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    }
    function drawLatest(ctx, point, position, previousClose, chartWidth, height, x, y, opacity) {
      const direction2 = point.price > previousClose ? "up" : point.price < previousClose ? "down" : "flat";
      const pointX = x(position);
      const pointY = y(point.price);
      const label = formatChangePercent(point.price, previousClose);
      ctx.save();
      ctx.globalAlpha = Math.max(0.55, opacity * 3.5);
      ctx.fillStyle = color(direction2);
      ctx.beginPath();
      ctx.arc(pointX, pointY, 3, 0, Math.PI * 2);
      ctx.fill();
      if (chartWidth >= 180 && height >= 60) {
        ctx.font = "600 11px system-ui, sans-serif";
        const textWidth = ctx.measureText(label).width;
        const labelX = clamp(pointX - textWidth - 13, 4, chartWidth - textWidth - 8);
        const labelY = clamp(pointY - 20, 4, height - 20);
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = "#181818";
        ctx.fillRect(labelX - 4, labelY - 1, textWidth + 8, 16);
        ctx.globalAlpha = 0.88;
        ctx.fillStyle = color(direction2);
        ctx.fillText(label, labelX, labelY + 11);
      }
      ctx.restore();
    }
    new MutationObserver(() => {
      sync();
      drawAll();
    }).observe(document.body, { childList: true, subtree: true });
    sync();
    void poll();
    setInterval(poll, 5e3);
  }
  function validPreviousClose(previousClose, points) {
    return Number.isFinite(previousClose) && previousClose > 0 ? previousClose : points[0].price;
  }
  function color(direction2) {
    return direction2 === "up" ? "#f14c4c" : direction2 === "down" ? "#89d185" : "#a0a0a0";
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
