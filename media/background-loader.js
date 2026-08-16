"use strict";
(() => {
  // src/background/chart-geometry.ts
  function priceGridLevels(min, max, previousClose) {
    return [
      { position: 0, price: max },
      { position: 0.25, price: (max + previousClose) / 2 },
      { position: 0.5, price: previousClose },
      { position: 0.75, price: (min + previousClose) / 2 },
      { position: 1, price: min }
    ];
  }
  function tradingTimeMarkers() {
    return [
      { position: 0, label: "09:30" },
      { position: 0.25, label: "10:30" },
      { position: 0.5, label: "11:30/13:00" },
      { position: 0.75, label: "14:00" },
      { position: 1, label: "15:00" }
    ];
  }
  function chartLayout(width, minimapLeft) {
    const safeWidth = Math.max(1, width);
    const hasMinimap = Number.isFinite(minimapLeft) && minimapLeft > 160 && minimapLeft < safeWidth;
    const scaleRight = Math.max(1, (hasMinimap ? minimapLeft : safeWidth) - 6);
    const showScale = scaleRight >= 460;
    const fallbackReserve = safeWidth >= 700 ? 104 : 56;
    const chartWidth = Math.max(1, showScale ? scaleRight - 112 : safeWidth - fallbackReserve);
    return { chartWidth, scaleLeft: chartWidth + 8, scaleRight, showScale };
  }
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
  function formatPriceScaleLabel(price, previousClose) {
    if (!Number.isFinite(price)) return "--";
    return `${price.toFixed(2)}  ${formatChangePercent(price, previousClose)}`;
  }
  function direction(delta) {
    return delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  }

  // src/background/browser-loader.ts
  var GRAPHITE = "#858a90";
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
    let eventPort;
    let events;
    const editors = /* @__PURE__ */ new Map();
    const style = document.createElement("style");
    style.textContent = ".a-stock-watch-background{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5}.a-stock-watch-scale{position:absolute;top:0;bottom:0;pointer-events:none;z-index:20;font:400 9px system-ui,sans-serif}.a-stock-watch-scale-label{position:absolute;left:0;white-space:nowrap;padding:1px 3px;background:rgba(24,24,24,.12);line-height:12px;color:#858a90;opacity:.24}.a-stock-watch-scale-label.current{font-weight:500;background:rgba(24,24,24,.18);opacity:.36}.a-stock-watch-time-axis{position:absolute;left:0;bottom:2px;height:16px;pointer-events:none;z-index:20;font:400 9px system-ui,sans-serif;color:#858a90;opacity:.24}.a-stock-watch-time-label{position:absolute;top:0;white-space:nowrap;padding:1px 3px;background:rgba(24,24,24,.1);line-height:12px;transform:translateX(-50%)}.a-stock-watch-time-label.first{transform:none}.a-stock-watch-time-label.last{transform:translateX(-100%)}.monaco-editor .view-lines,.monaco-editor .margin-view-overlays{position:relative;z-index:6}";
    document.head.appendChild(style);
    async function poll() {
      const ports = activePort ? [activePort] : Array.from({ length: portEnd - portStart + 1 }, (_, index) => portStart + index);
      for (const port of ports) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/${token}/state`, { cache: "no-store" });
          if (!response.ok) continue;
          state = await response.json();
          activePort = port;
          connectEvents(port);
          sync();
          drawAll();
          return;
        } catch {
        }
      }
      activePort = void 0;
    }
    function connectEvents(port) {
      if (events && eventPort === port) return;
      events?.close();
      const source = new EventSource(`http://127.0.0.1:${port}/${token}/events`);
      events = source;
      eventPort = port;
      source.addEventListener("change", () => {
        void poll();
      });
      source.onerror = () => {
        if (events !== source) return;
        source.close();
        events = void 0;
        eventPort = void 0;
      };
    }
    function sync() {
      document.querySelectorAll(".monaco-editor").forEach((host) => {
        if (editors.has(host)) return;
        const canvas = document.createElement("canvas");
        canvas.className = "a-stock-watch-background";
        const scale = createScale();
        const timeAxis = createTimeAxis();
        host.append(canvas, scale, timeAxis);
        editors.set(host, { canvas, scale, timeAxis });
        new ResizeObserver(() => draw(canvas, scale, timeAxis)).observe(host);
      });
      for (const [host] of editors) if (!host.isConnected) editors.delete(host);
    }
    function drawAll() {
      editors.forEach(({ canvas, scale, timeAxis }) => draw(canvas, scale, timeAxis));
    }
    function draw(canvas, scale, timeAxis) {
      const visible = state?.background?.visible !== false;
      canvas.style.display = visible ? "block" : "none";
      if (!visible) {
        scale.style.display = "none";
        timeAxis.style.display = "none";
        return;
      }
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
      const hostRect = canvas.parentElement?.getBoundingClientRect();
      const minimapRect = canvas.parentElement?.querySelector(".minimap")?.getBoundingClientRect();
      const minimapLeft = hostRect && minimapRect ? minimapRect.left - hostRect.left : void 0;
      const layout = chartLayout(rect.width, minimapLeft);
      const chartWidth = layout.chartWidth;
      const options = state?.background ?? { visible: true, opacity: 0.08, showAverage: true, showVolume: false, lineWidth: 0.75 };
      const baseOpacity = clamp(options.opacity, 0.02, 0.25);
      const positions = points.map(
        (point, index) => tradingSessionProgress(point.time) ?? index / Math.max(1, points.length - 1)
      );
      const x = (position) => clamp(position, 0, 1) * chartWidth;
      const y = (price) => (range.max - price) / (range.max - range.min) * rect.height;
      const zeroY = y(previousClose);
      const segments = splitPriceSegments(points.map((point) => point.price), positions, previousClose);
      const gridLevels = priceGridLevels(range.min, range.max, previousClose);
      const timeMarkers = tradingTimeMarkers();
      drawGuideLines(ctx, chartWidth, rect.height, baseOpacity, gridLevels, timeMarkers);
      drawZeroLine(ctx, chartWidth, zeroY, baseOpacity);
      drawSegmentFill(ctx, segments, x, y, zeroY, baseOpacity);
      drawPriceSegments(ctx, segments, x, y, options.lineWidth, baseOpacity);
      if (options.showAverage) drawAverage(ctx, points, positions, x, y, options.lineWidth, baseOpacity);
      const latest = points.at(-1);
      drawLatest(ctx, latest, positions.at(-1), previousClose, chartWidth, rect.height, x, y, baseOpacity, layout.showScale);
      updatePriceScale(scale, gridLevels, latest, previousClose, layout, rect.height, y);
      updateTimeAxis(timeAxis, layout, rect.height);
    }
    function createScale() {
      const scale = document.createElement("div");
      scale.className = "a-stock-watch-scale";
      for (const role of ["top", "upper", "current", "zero", "lower", "bottom"]) {
        const label = document.createElement("div");
        label.className = `a-stock-watch-scale-label ${role}`;
        label.dataset.role = role;
        scale.appendChild(label);
      }
      return scale;
    }
    function createTimeAxis() {
      const axis = document.createElement("div");
      axis.className = "a-stock-watch-time-axis";
      const markers = tradingTimeMarkers();
      markers.forEach((marker, index) => {
        const label = document.createElement("div");
        label.className = `a-stock-watch-time-label${index === 0 ? " first" : index === markers.length - 1 ? " last" : ""}`;
        label.style.left = `${marker.position * 100}%`;
        label.textContent = marker.label;
        axis.appendChild(label);
      });
      return axis;
    }
    function drawGuideLines(ctx, width, height, opacity, levels, timeMarkers) {
      ctx.save();
      ctx.globalAlpha = clamp(opacity * 0.25, 0.012, 0.03);
      ctx.strokeStyle = GRAPHITE;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 7]);
      for (const level of levels) {
        const py = clamp(level.position * height, 0.5, height - 0.5);
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(width, py);
        ctx.stroke();
      }
      ctx.globalAlpha = clamp(opacity * 0.18, 0.01, 0.024);
      for (const marker of timeMarkers) {
        const px = clamp(marker.position * width, 0.5, width - 0.5);
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
        ctx.stroke();
      }
      ctx.restore();
    }
    function drawZeroLine(ctx, width, zeroY, opacity) {
      ctx.save();
      ctx.globalAlpha = clamp(opacity * 0.5, 0.028, 0.05);
      ctx.strokeStyle = GRAPHITE;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(0, zeroY);
      ctx.lineTo(width, zeroY);
      ctx.stroke();
      ctx.restore();
    }
    function drawSegmentFill(ctx, segments, x, y, zeroY, opacity) {
      ctx.save();
      ctx.globalAlpha = clamp(opacity * 0.05, 3e-3, 8e-3);
      for (const segment of segments) {
        ctx.beginPath();
        ctx.moveTo(x(segment.fromPosition), zeroY);
        ctx.lineTo(x(segment.fromPosition), y(segment.fromPrice));
        ctx.lineTo(x(segment.toPosition), y(segment.toPrice));
        ctx.lineTo(x(segment.toPosition), zeroY);
        ctx.closePath();
        ctx.fillStyle = GRAPHITE;
        ctx.fill();
      }
      ctx.restore();
    }
    function drawPriceSegments(ctx, segments, x, y, width, opacity) {
      ctx.save();
      ctx.globalAlpha = clamp(opacity * 1.1, 0.06, 0.1);
      ctx.lineWidth = clamp(width, 0.5, 0.85);
      for (const segment of segments) {
        ctx.beginPath();
        ctx.moveTo(x(segment.fromPosition), y(segment.fromPrice));
        ctx.lineTo(x(segment.toPosition), y(segment.toPrice));
        ctx.strokeStyle = GRAPHITE;
        ctx.stroke();
      }
      ctx.restore();
    }
    function drawAverage(ctx, points, positions, x, y, width, opacity) {
      ctx.save();
      ctx.globalAlpha = clamp(opacity * 0.55, 0.03, 0.055);
      ctx.strokeStyle = "#777b80";
      ctx.lineWidth = clamp(width * 0.75, 0.45, 0.65);
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
    function drawLatest(ctx, point, position, previousClose, chartWidth, height, x, y, opacity, scaleVisible) {
      const pointX = x(position);
      const pointY = y(point.price);
      const label = formatChangePercent(point.price, previousClose);
      ctx.save();
      ctx.globalAlpha = clamp(opacity * 0.7, 0.035, 0.06);
      ctx.strokeStyle = GRAPHITE;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      const guideStart = pointX + 56 <= chartWidth ? pointX : Math.max(0, pointX - 56);
      const guideEnd = pointX + 56 <= chartWidth ? pointX + 56 : pointX;
      ctx.beginPath();
      ctx.moveTo(guideStart, pointY);
      ctx.lineTo(guideEnd, pointY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = clamp(opacity * 1.6, 0.1, 0.16);
      ctx.fillStyle = GRAPHITE;
      ctx.beginPath();
      ctx.arc(pointX, pointY, 1.75, 0, Math.PI * 2);
      ctx.fill();
      if (!scaleVisible && chartWidth >= 180 && height >= 60) {
        ctx.font = "600 11px system-ui, sans-serif";
        const textWidth = ctx.measureText(label).width;
        const labelX = clamp(pointX - textWidth - 13, 4, chartWidth - textWidth - 8);
        const labelY = clamp(pointY - 20, 4, height - 20);
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = "#181818";
        ctx.fillRect(labelX - 4, labelY - 1, textWidth + 8, 16);
        ctx.globalAlpha = 0.38;
        ctx.fillStyle = GRAPHITE;
        ctx.fillText(label, labelX, labelY + 11);
      }
      ctx.restore();
    }
    function updatePriceScale(scale, levels, latest, previousClose, layout, height, y) {
      scale.style.display = layout.showScale ? "block" : "none";
      if (!layout.showScale) return;
      scale.style.left = `${layout.scaleLeft}px`;
      scale.style.width = `${Math.max(1, layout.scaleRight - layout.scaleLeft)}px`;
      const fixedY = [4, height * 0.25 - 7, height * 0.5 - 8, height * 0.75 - 7, Math.max(4, height - 20)];
      const zeroY = fixedY[2];
      const currentRawY = clamp(y(latest.price) - 8, 22, height - 40);
      const currentY = avoidLabelCollisions(currentRawY, fixedY, 22, height - 40, latest.price >= previousClose);
      const latestDirection = latest.price > previousClose ? "up" : latest.price < previousClose ? "down" : "flat";
      setScaleLabel(scale, "top", formatPriceScaleLabel(levels[0].price, previousClose), fixedY[0], GRAPHITE);
      setScaleLabel(scale, "upper", formatPriceScaleLabel(levels[1].price, previousClose), fixedY[1], GRAPHITE);
      setScaleLabel(
        scale,
        "current",
        formatPriceScaleLabel(latest.price, previousClose),
        currentY,
        GRAPHITE,
        latestDirection !== "flat"
      );
      setScaleLabel(scale, "zero", formatPriceScaleLabel(levels[2].price, previousClose), fixedY[2], GRAPHITE);
      setScaleLabel(scale, "lower", formatPriceScaleLabel(levels[3].price, previousClose), fixedY[3], GRAPHITE);
      setScaleLabel(scale, "bottom", formatPriceScaleLabel(levels[4].price, previousClose), fixedY[4], GRAPHITE);
    }
    function updateTimeAxis(axis, layout, height) {
      const visible = layout.chartWidth >= 520 && height >= 160;
      axis.style.display = visible ? "block" : "none";
      if (!visible) return;
      axis.style.width = `${layout.chartWidth}px`;
    }
    function setScaleLabel(scale, role, label, y, textColor, visible = true) {
      const element = scale.querySelector(`[data-role="${role}"]`);
      if (!element) return;
      element.style.display = visible ? "block" : "none";
      element.style.top = `${y}px`;
      element.style.color = textColor;
      if (element.textContent !== label) element.textContent = label;
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
  function avoidLabelCollisions(preferred, fixed, min, max, preferDown) {
    let position = clamp(preferred, min, max);
    for (let attempt = 0; attempt < fixed.length + 1; attempt += 1) {
      const collision = fixed.find((value) => Math.abs(position - value) < 17);
      if (collision === void 0) return position;
      const down = collision + 18;
      const up = collision - 18;
      position = preferDown && down <= max ? down : up >= min ? up : clamp(down, min, max);
    }
    return position;
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
