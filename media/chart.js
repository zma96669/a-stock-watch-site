(() => {
  const canvas = document.getElementById('chart');
  const ctx = canvas.getContext('2d');
  const nameEl = document.getElementById('name');
  const metaEl = document.getElementById('meta');
  const tip = document.getElementById('tip');
  let snapshot = { quotes: {}, intraday: [], stale: false };
  let points = [];

  addEventListener('message', (event) => {
    if (event.data?.type !== 'snapshot') return;
    snapshot = event.data.payload;
    const quote = snapshot.currentCode ? snapshot.quotes[snapshot.currentCode] : undefined;
    nameEl.textContent = quote ? `${quote.name}  ${quote.code}` : '请选择股票';
    const pct = quote?.changePercent;
    const latest = snapshot.intraday?.at(-1);
    metaEl.textContent = quote ? `最新 ${fmt(quote.price)}　涨跌 ${pct == null ? '--' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}　成交量 ${compact(quote.volume)}　量比 ${latest?.volumeRatio == null ? '--' : latest.volumeRatio.toFixed(2) + 'x'}` : '';
    metaEl.className = `meta${snapshot.stale ? ' stale' : ''}`;
    points = snapshot.intraday || [];
    draw();
  });

  const resize = new ResizeObserver(draw);
  resize.observe(canvas.parentElement);
  canvas.addEventListener('mousemove', (event) => {
    if (!points.length) return;
    const rect = canvas.getBoundingClientRect();
    const index = Math.max(0, Math.min(points.length - 1, Math.round((event.offsetX - 48) / Math.max(1, rect.width - 64) * (points.length - 1))));
    const point = points[index];
    tip.style.display = 'block';
    tip.style.left = `${Math.min(rect.width - 150, event.offsetX + 10)}px`;
    tip.style.top = `${Math.max(5, event.offsetY - 42)}px`;
    tip.textContent = `${point.time.slice(-5)}  价格 ${point.price.toFixed(2)}  均价 ${point.averagePrice.toFixed(2)}  成交额 ${compact(point.amount)} 量比 ${point.volumeRatio == null ? '--' : point.volumeRatio.toFixed(2) + 'x'}`;
  });
  canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!points.length) {
      ctx.fillStyle = css('--vscode-descriptionForeground', '#888');
      ctx.fillText('暂无分时数据', 20, 35);
      return;
    }
    const left = 48, right = 16, top = 18, priceBottom = Math.max(top + 36, rect.height * .74), volumeTop = Math.min(rect.height - 42, priceBottom + Math.max(10, rect.height * .05)), bottom = Math.max(volumeTop + 18, rect.height - 22);
    const prev = snapshot.previousClose || points[0].price;
    const prices = points.flatMap((p) => [p.price, p.averagePrice]);
    const delta = Math.max(...prices.map((p) => Math.abs(p - prev)), prev * .005);
    const min = prev - delta * 1.08, max = prev + delta * 1.08;
    const x = (i) => left + i / Math.max(1, points.length - 1) * (rect.width - left - right);
    const y = (p) => top + (max - p) / (max - min) * (priceBottom - top);
    ctx.strokeStyle = css('--vscode-editorWidget-border', '#555'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left, y(prev)); ctx.lineTo(rect.width - right, y(prev)); ctx.stroke();
    ctx.save(); ctx.globalAlpha = .55; ctx.setLineDash([3, 6]); ctx.beginPath(); ctx.moveTo(left, volumeTop); ctx.lineTo(rect.width - right, volumeTop); ctx.stroke(); ctx.restore();
    line('averagePrice', css('--vscode-charts-yellow', '#d7ba7d'), 1.2, x, y);
    const latest = points[points.length - 1].price;
    line('price', latest >= prev ? css('--vscode-charts-red', '#f14c4c') : css('--vscode-charts-green', '#89d185'), 1.8, x, y);
    const maxVolume = Math.max(1, ...points.map((p) => p.volume));
    ctx.globalAlpha = .6;
    points.forEach((p, i) => { const h = p.volume / maxVolume * (bottom - volumeTop - 2); const previous = i ? points[i - 1].price : prev; ctx.fillStyle = p.price > previous ? css('--vscode-charts-red', '#a16f72') : p.price < previous ? css('--vscode-charts-green', '#6f9181') : css('--vscode-descriptionForeground', '#858a90'); ctx.fillRect(x(i), bottom - h, Math.max(1, (rect.width-left-right)/points.length), h); });
    ctx.globalAlpha = 1; ctx.fillStyle = css('--vscode-descriptionForeground', '#888'); ctx.font = '11px sans-serif';
    ctx.fillText(max.toFixed(2), 4, top + 4); ctx.fillText(prev.toFixed(2), 4, y(prev) + 4); ctx.fillText(min.toFixed(2), 4, priceBottom);
    ctx.fillText(points[0].time.slice(-5), left, rect.height - 5); ctx.fillText(points[points.length - 1].time.slice(-5), rect.width - 48, rect.height - 5);
  }
  function line(field, color, width, x, y) { ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(x(i), y(p[field])) : ctx.moveTo(x(i), y(p[field]))); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
  function css(name, fallback) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; }
  function fmt(value) { return value == null ? '--' : value.toFixed(2); }
  function compact(value) { return value == null ? '--' : value >= 1e8 ? `${(value/1e8).toFixed(2)}亿` : value >= 1e4 ? `${(value/1e4).toFixed(2)}万` : String(value); }
})();
