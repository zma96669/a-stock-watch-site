(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Lightweight particle field: enough depth for the hero, with an automatic mobile fallback.
  const canvas = document.querySelector('#particle-canvas');
  const context = canvas?.getContext('2d');
  const pointer = { x: -1000, y: -1000, active: false };
  let particles = [];
  let frame = 0;

  const resizeCanvas = () => {
    if (!canvas || !context) return;
    const density = window.innerWidth < 600 ? 0.000025 : window.innerWidth < 1000 ? 0.000045 : 0.00007;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = window.innerWidth * ratio;
    canvas.height = Math.min(window.innerHeight, 940) * ratio;
    canvas.style.height = `${Math.min(window.innerHeight, 940)}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.max(30, Math.round(window.innerWidth * Math.min(window.innerHeight, 940) * density));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * Math.min(window.innerHeight, 940),
      vx: (Math.random() - 0.5) * 0.16,
      vy: (Math.random() - 0.5) * 0.16,
      radius: Math.random() * 1.5 + 0.35,
      alpha: Math.random() * 0.45 + 0.1,
      hue: Math.random() > 0.75 ? 264 : 188,
    }));
  };

  const drawParticles = () => {
    if (!canvas || !context || reducedMotion) return;
    const width = window.innerWidth;
    const height = Math.min(window.innerHeight, 940);
    context.clearRect(0, 0, width, height);
    for (const p of particles) {
      const dx = pointer.x - p.x;
      const dy = pointer.y - p.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (pointer.active && distance < 150) {
        const force = (150 - distance) / 1500;
        p.vx -= dx * force * 0.014;
        p.vy -= dy * force * 0.014;
      }
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -20) p.x = width + 20;
      if (p.x > width + 20) p.x = -20;
      if (p.y < -20) p.y = height + 20;
      if (p.y > height + 20) p.y = -20;
      context.beginPath();
      context.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      context.fillStyle = `hsla(${p.hue}, 90%, 72%, ${p.alpha})`;
      context.fill();
    }
    for (let i = 0; i < particles.length; i += 1) {
      for (let j = i + 1; j < particles.length; j += 1) {
        const a = particles[i];
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 115) {
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.strokeStyle = `rgba(74, 191, 244, ${0.075 * (1 - distance / 115)})`;
          context.lineWidth = 0.65;
          context.stroke();
        }
      }
    }
    frame = requestAnimationFrame(drawParticles);
  };

  if (canvas && context && !reducedMotion) {
    resizeCanvas();
    drawParticles();
    window.addEventListener('resize', resizeCanvas, { passive: true });
    window.addEventListener('pointermove', (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
    }, { passive: true });
    window.addEventListener('pointerleave', () => { pointer.active = false; }, { passive: true });
  }

  // Scroll progress and header state.
  const progress = document.querySelector('.page-progress span');
  const header = document.querySelector('.site-header');
  const updateScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.transform = `scaleX(${max > 0 ? window.scrollY / max : 0})`;
    header?.classList.toggle('scrolled', window.scrollY > 24);
  };
  window.addEventListener('scroll', updateScroll, { passive: true });
  updateScroll();

  // Reveal sections as they enter the viewport.
  const revealItems = [...document.querySelectorAll('.reveal')];
  revealItems.forEach((item) => {
    const delay = Number(item.dataset.delay || 0);
    item.style.setProperty('--delay', `${delay}ms`);
  });
  if ('IntersectionObserver' in window && !reducedMotion) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -35px' });
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('visible'));
  }

  // Counter animation in the hero.
  document.querySelectorAll('.counter').forEach((counter) => {
    const target = Number(counter.dataset.count || 0);
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      const start = performance.now();
      const duration = 1100;
      const tick = (now) => {
        const progressValue = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progressValue, 3);
        counter.textContent = String(Math.round(target * eased));
        if (progressValue < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    if (reducedMotion) run();
    else new IntersectionObserver((entries, observer) => { if (entries[0].isIntersecting) { run(); observer.disconnect(); } }).observe(counter);
  });

  // Cursor spotlight and small tilt on high-surface cards.
  document.querySelectorAll('.spotlight-card').forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      card.style.setProperty('--my', `${event.clientY - rect.top}px`);
    }, { passive: true });
  });
  if (!reducedMotion) {
    document.querySelectorAll('.tilt-card').forEach((card) => {
      const intensity = Number(card.dataset.tilt || 3);
      card.addEventListener('pointermove', (event) => {
        const rect = card.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `perspective(1400px) rotateY(${x * intensity}deg) rotateX(${-y * intensity}deg)`;
      }, { passive: true });
      card.addEventListener('pointerleave', () => {
        card.style.transform = card.classList.contains('workbench') ? 'perspective(1400px) rotateY(-7deg) rotateX(3deg)' : 'perspective(1400px) rotateX(3deg)';
      }, { passive: true });
    });
  }

  // Mobile navigation.
  const navToggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.site-nav');
  navToggle?.addEventListener('click', () => {
    const open = nav?.classList.toggle('open');
    navToggle.classList.toggle('active', open);
    navToggle.setAttribute('aria-expanded', String(Boolean(open)));
  });
  nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    nav.classList.remove('open');
    navToggle?.classList.remove('active');
    navToggle?.setAttribute('aria-expanded', 'false');
  }));

  // Animated market terminal. This is explicitly marked as a visual simulation on the page.
  const chart = document.querySelector('#live-chart-svg');
  const line = document.querySelector('#live-line');
  const area = document.querySelector('#live-area');
  const average = document.querySelector('#average-line');
  const bars = document.querySelector('#volume-bars');
  const cursorX = document.querySelector('#cursor-x');
  const cursorDot = document.querySelector('#cursor-dot');
  const livePrice = document.querySelector('#live-price');
  const liveChange = document.querySelector('#live-change');
  const ratio = document.querySelector('#volume-ratio');
  const chartWidth = 800;
  const chartHeight = 310;
  const points = Array.from({ length: 82 }, (_, index) => {
    const wave = Math.sin(index * .42) * 10 + Math.sin(index * .14 + 2) * 18;
    const trend = index * 1.05;
    return 182 - trend - wave + (Math.random() - .5) * 7;
  });

  const makePath = (values) => values.map((y, index) => `${index === 0 ? 'M' : 'L'} ${(index / (values.length - 1)) * chartWidth} ${y.toFixed(2)}`).join(' ');
  const renderChart = (shift = 0) => {
    const values = points.map((point, index) => point + Math.sin(index * .35 + shift) * 2.6);
    const path = makePath(values);
    if (line) line.setAttribute('d', path);
    if (area) area.setAttribute('d', `${path} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`);
    if (average) average.setAttribute('d', `M0 ${values.reduce((a, b) => a + b, 0) / values.length} H${chartWidth}`);
    if (bars && !bars.childElementCount) {
      values.forEach((_, index) => {
        const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const height = 7 + Math.abs(Math.sin(index * .7)) * 20 + Math.random() * 13;
        bar.setAttribute('x', String(index * (chartWidth / values.length) + 1));
        bar.setAttribute('y', String(chartHeight - height));
        bar.setAttribute('width', String(Math.max(2, chartWidth / values.length - 3)));
        bar.setAttribute('height', String(height));
        bar.setAttribute('fill', index % 4 === 0 ? '#ff7189' : '#54d9bb');
        bars.appendChild(bar);
      });
    }
    const cursorIndex = Math.floor(((Math.sin(shift * .4) + 1) / 2) * (values.length - 1));
    const cursorPosition = cursorIndex / (values.length - 1) * chartWidth;
    cursorX?.setAttribute('x1', String(cursorPosition)); cursorX?.setAttribute('x2', String(cursorPosition));
    cursorDot?.setAttribute('cx', String(cursorPosition)); cursorDot?.setAttribute('cy', String(values[cursorIndex]));
    const price = 11.18 + (182 - values[cursorIndex]) * .004;
    const change = (price - 11.24) / 11.24 * 100;
    if (livePrice) livePrice.textContent = price.toFixed(2);
    if (liveChange) {
      liveChange.textContent = `${change >= 0 ? '+' : ''}${(price - 11.24).toFixed(2)}   ${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
      liveChange.classList.toggle('quote-up', change >= 0);
      liveChange.classList.toggle('quote-down', change < 0);
    }
    if (ratio) ratio.textContent = (1.12 + Math.abs(Math.sin(shift * .25)) * .44).toFixed(2);
  };
  if (chart && line && area) {
    let shift = 0;
    const animateChart = () => { shift += .035; renderChart(shift); if (!reducedMotion) requestAnimationFrame(animateChart); };
    renderChart(0);
    if (!reducedMotion) requestAnimationFrame(animateChart);
    chart.addEventListener('pointermove', (event) => {
      const rect = chart.getBoundingClientRect();
      const x = Math.max(0, Math.min(chartWidth, (event.clientX - rect.left) / rect.width * chartWidth));
      const index = Math.round(x / chartWidth * (points.length - 1));
      const y = points[index];
      cursorX?.setAttribute('x1', String(x)); cursorX?.setAttribute('x2', String(x));
      cursorDot?.setAttribute('cx', String(x)); cursorDot?.setAttribute('cy', String(y));
    }, { passive: true });
  }

  // Retail-account trend dashboard. Data is generated by GitHub Actions and kept as
  // a small static JSON file so the public site never needs a proxy or API key.
  const retail = (() => {
    const chartSvg = document.querySelector('#retail-chart');
    const chartWrap = document.querySelector('.retail-chart-wrap');
    const search = document.querySelector('#retail-search');
    const suggestions = document.querySelector('#retail-suggestions');
    const status = document.querySelector('#retail-status');
    if (!chartSvg || !chartWrap || !search || !suggestions) return undefined;

    const width = 960;
    const plotTop = 14;
    const plotBottom = 350;
    const height = plotBottom - plotTop;
    const byId = (id) => document.querySelector(`#${id}`);
    const nodes = {
      priceArea: byId('retail-price-area'),
      priceLine: byId('retail-price-line'),
      holderLine: byId('retail-holder-line'),
      estimateLine: byId('retail-estimate-line'),
      holderDots: byId('retail-holder-dots'),
      estimateDots: byId('retail-estimate-dots'),
      disclosureLines: byId('retail-disclosure-lines'),
      cursorX: byId('retail-cursor-x'),
      cursorDot: byId('retail-cursor-dot'),
      tooltip: byId('retail-tooltip'),
      methodology: byId('retail-methodology'),
      name: byId('retail-name'),
      price: byId('retail-price'),
      change: byId('retail-change'),
      holders: byId('retail-holders'),
      estimate: byId('retail-estimate'),
      ratio: byId('retail-ratio'),
      confidence: byId('retail-confidence'),
      frequency: byId('retail-frequency'),
      averageShares: byId('retail-average-shares'),
      correlation: byId('retail-correlation'),
      asof: byId('retail-asof'),
      detailHolder: byId('retail-detail-holder'),
      detailPrice: byId('retail-detail-price'),
      detailChange: byId('retail-detail-change'),
      detailAmount: byId('retail-detail-amount'),
      detailTurnover: byId('retail-detail-turnover'),
      detailEstimate: byId('retail-detail-estimate'),
      detailRatio: byId('retail-detail-ratio'),
      detailInstitution: byId('retail-detail-institution'),
      detailCorporate: byId('retail-detail-corporate'),
      detailTop10: byId('retail-detail-top10'),
      detailAsOf: byId('retail-detail-asof'),
      detailNotice: byId('retail-detail-notice'),
      detailAverageShares: byId('retail-detail-average-shares'),
      detailAverageAmount: byId('retail-detail-average-amount'),
      detailConcentration: byId('retail-detail-concentration'),
      detailCoverage: byId('retail-detail-coverage'),
      detailSourceStatus: byId('retail-detail-source-status'),
      holderSource: byId('retail-source-holders'),
      priceSource: byId('retail-source-prices'),
      quoteSource: byId('retail-source-quote'),
      universeSource: byId('retail-source-universe'),
      priceMax: byId('retail-price-max'),
      priceMin: byId('retail-price-min'),
      holderMax: byId('retail-holder-max'),
      holderMin: byId('retail-holder-min')
    };
    const state = { symbols: [], searchSymbols: [], current: undefined, range: 'all', view: undefined, universeSource: undefined, realtimeLoading: false };
    const realtimeRefreshMs = 5000;
    let selectionToken = 0;

    const number = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const dateValue = (value) => {
      const raw = String(value ?? '').trim();
      if (!raw) return undefined;
      const text = raw.includes(' ') ? raw.replace(' ', 'T') : `${raw.slice(0, 10)}T00:00:00`;
      const timestamp = Date.parse(text);
      return Number.isFinite(timestamp) ? timestamp : undefined;
    };
    const dateText = (value) => {
      const raw = String(value ?? '').trim();
      return raw.includes(' ') ? raw.slice(5, 16).replace(' ', ' ') : raw.slice(0, 10).replaceAll('-', '.');
    };
    const compact = (value) => {
      const n = number(value);
      if (n === undefined) return '--';
      if (Math.abs(n) >= 100000000) return `${(n / 100000000).toFixed(2)}亿`;
      if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}万`;
      return Math.round(n).toLocaleString('zh-CN');
    };
    const priceText = (value) => {
      const n = number(value);
      return n === undefined ? '--' : n.toFixed(2);
    };
    const exactText = (value) => {
      const n = number(value);
      return n === undefined ? '--' : n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    };
    const percentText = (value) => {
      const n = number(value);
      return n === undefined ? '--' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
    };
    const confidenceText = (value) => ({ A: 'A · 明细充分', B: 'B · 部分识别', C: 'C · 户数代理' }[value] || '--');
    const setText = (node, value) => { if (node) node.textContent = value; };
    const setStatus = (message) => setText(status, message);
    const setLink = (node, url) => {
      if (!node) return;
      node.href = url || '#';
      node.classList.toggle('is-disabled', !url);
      node.setAttribute('aria-disabled', String(!url));
    };
    const clearDetails = () => {
      [nodes.detailPrice, nodes.detailChange, nodes.detailAmount, nodes.detailTurnover, nodes.detailHolder, nodes.detailEstimate, nodes.detailRatio, nodes.detailInstitution, nodes.detailCorporate, nodes.detailTop10, nodes.detailAsOf, nodes.detailNotice, nodes.detailAverageShares, nodes.detailAverageAmount, nodes.detailConcentration, nodes.detailCoverage, nodes.detailSourceStatus].forEach((node) => setText(node, '--'));
      [nodes.universeSource, nodes.holderSource, nodes.priceSource, nodes.quoteSource].forEach((node) => setLink(node, undefined));
    };

    function realtimeUrls(symbol) {
      const market = symbol.market === 'SH' || String(symbol.code).startsWith('6') ? '1' : '0';
      const secid = `${market}.${symbol.code}`;
      return {
        quote: `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f47,f48,f58,f60,f168,f170`,
        trends: `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58`
      };
    }

    async function fetchRealtimeSymbol(symbol) {
      const urls = realtimeUrls(symbol);
      const [quoteResponse, trendsResponse] = await Promise.all([
        fetch(urls.quote, { cache: 'no-store' }),
        fetch(urls.trends, { cache: 'no-store' })
      ]);
      if (!quoteResponse.ok) throw new Error(`实时报价 HTTP ${quoteResponse.status}`);
      const quotePayload = await quoteResponse.json();
      const quote = quotePayload?.data || {};
      const trendsPayload = trendsResponse.ok ? await trendsResponse.json() : {};
      const trends = Array.isArray(trendsPayload?.data?.trends) ? trendsPayload.data.trends : [];
      const prices = trends.map((row) => {
        const fields = String(row).split(',');
        return {
          date: fields[0],
          close: number(fields[1]),
          average: number(fields[2]),
          volume: number(fields[5]),
          amount: number(fields[6])
        };
      }).filter((point) => point.date && point.close !== undefined);
      return {
        name: quote.f58 || symbol.name,
        latestQuote: {
          price: number(quote.f43) === undefined ? symbol.latestQuote?.price : number(quote.f43) / 100,
          previousClose: number(quote.f60) === undefined ? symbol.latestQuote?.previousClose : number(quote.f60) / 100,
          changePercent: number(quote.f170) === undefined ? symbol.latestQuote?.changePercent : number(quote.f170) / 100,
          turnoverRate: number(quote.f168) === undefined ? symbol.latestQuote?.turnoverRate : number(quote.f168) / 100,
          volume: number(quote.f47),
          amount: number(quote.f48)
        },
        prices,
        realtime: true,
        sourceStatus: {
          ...(symbol.sourceStatus || {}),
          realtime: '东方财富实时报价与分时接口',
          quoteUrl: urls.quote,
          pricesUrl: urls.trends,
          fetchedAt: new Date().toISOString()
        }
      };
    }

    function clearChart() {
      [nodes.priceArea, nodes.priceLine, nodes.holderLine, nodes.estimateLine].forEach((node) => node?.setAttribute('d', ''));
      [nodes.holderDots, nodes.estimateDots, nodes.disclosureLines].forEach((node) => { if (node) node.replaceChildren(); });
      nodes.cursorX?.style.setProperty('opacity', '0');
      nodes.cursorDot?.style.setProperty('opacity', '0');
      if (nodes.tooltip) nodes.tooltip.hidden = true;
      ['priceMax', 'priceMin', 'holderMax', 'holderMin'].forEach((key) => setText(nodes[key], '--'));
    }

    function pathFor(points, valueKey, xFor, yFor) {
      return points.filter((point) => number(point[valueKey]) !== undefined)
        .map((point, index) => `${index ? 'L' : 'M'} ${xFor(point.date).toFixed(2)} ${yFor(number(point[valueKey])).toFixed(2)}`).join(' ');
    }

    function scale(values, fallback = [0, 1]) {
      const valid = values.map(number).filter((value) => value !== undefined);
      if (!valid.length) return fallback;
      let min = Math.min(...valid);
      let max = Math.max(...valid);
      if (min === max) {
        const pad = Math.abs(min) * 0.05 || 1;
        min -= pad;
        max += pad;
      } else {
        const pad = (max - min) * 0.08;
        min -= pad;
        max += pad;
      }
      return [min, max];
    }

    function nearest(points, timestamp) {
      if (!points?.length || timestamp === undefined) return undefined;
      return points.reduce((best, point) => {
        const distance = Math.abs(dateValue(point.date) - timestamp);
        return !best || distance < best.distance ? { point, distance } : best;
      }, undefined)?.point;
    }

    function correlation(left, right) {
      const pairs = left.map((value, index) => [number(value), number(right[index])]).filter(([a, b]) => a !== undefined && b !== undefined);
      if (pairs.length < 4) return undefined;
      const meanA = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
      const meanB = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
      let numerator = 0;
      let varianceA = 0;
      let varianceB = 0;
      pairs.forEach(([a, b]) => { const da = a - meanA; const db = b - meanB; numerator += da * db; varianceA += da * da; varianceB += db * db; });
      const denominator = Math.sqrt(varianceA * varianceB);
      return denominator ? numerator / denominator : undefined;
    }

    function rangeStart(end, range) {
      const start = new Date(end);
      if (range === '3y') start.setFullYear(start.getFullYear() - 3);
      else if (range === '1y') start.setFullYear(start.getFullYear() - 1);
      else if (range === '3m') start.setMonth(start.getMonth() - 3);
      else return undefined;
      return start.getTime();
    }

    function renderSuggestions(query = '') {
      const needle = query.trim().toLowerCase();
      const matches = state.searchSymbols.filter((symbol) => !needle || `${symbol.code} ${symbol.name}`.toLowerCase().includes(needle)).slice(0, 8);
      suggestions.replaceChildren();
      matches.forEach((symbol) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.code = symbol.code;
        const name = document.createElement('span');
        name.textContent = symbol.name || symbol.code;
        const code = document.createElement('small');
        code.textContent = `${symbol.code} · ${symbol.dataReady ? '趋势已采集 · 实时刷新' : '实时行情 · 分时加载'}`;
        button.append(name, code);
        suggestions.append(button);
      });
      suggestions.classList.toggle('open', matches.length > 0 && (document.activeElement === search || needle.length > 0));
    }

    async function selectSymbol(symbol) {
      const token = ++selectionToken;
      const trend = state.symbols.find((item) => item.code === symbol.code);
      state.current = trend ? { ...symbol, ...trend, dataReady: true } : { ...symbol, dataReady: false, prices: [], holders: [] };
      search.value = `${symbol.name || symbol.code}`;
      suggestions.classList.remove('open');
      setStatus('正在读取实时行情…');
      render();
      try {
        const realtime = await fetchRealtimeSymbol(state.current);
        if (token !== selectionToken) return;
        state.current = { ...state.current, ...realtime };
        render();
      } catch (error) {
        if (token !== selectionToken) return;
        setStatus('实时行情读取失败 · 保留快照');
        console.warn('[retail realtime]', error);
      }
    }

    async function refreshCurrentRealtime() {
      if (!state.current || state.realtimeLoading || document.visibilityState === 'hidden') return;
      const target = state.current;
      state.realtimeLoading = true;
      try {
        const realtime = await fetchRealtimeSymbol(target);
        if (state.current === target) {
          state.current = { ...target, ...realtime };
          render();
        }
      } catch (error) {
        console.warn('[retail realtime refresh]', error);
      } finally {
        state.realtimeLoading = false;
      }
    }

    function render() {
      const symbol = state.current;
      if (!symbol) { clearChart(); setStatus('没有可用股票数据'); return; }
      const prices = (symbol.prices || []).filter((point) => dateValue(point.date) !== undefined && number(point.close) !== undefined).sort((a, b) => dateValue(a.date) - dateValue(b.date));
      const holders = (symbol.holders || []).filter((point) => dateValue(point.asOf) !== undefined && number(point.shareholderAccounts) !== undefined).map((point) => ({ ...point, date: point.asOf })).sort((a, b) => dateValue(a.date) - dateValue(b.date));
      const priceDates = prices.map((point) => dateValue(point.date)).filter((value) => value !== undefined);
      const holderDates = holders.map((point) => dateValue(point.date)).filter((value) => value !== undefined);
      const allDates = priceDates.concat(holderDates);
      if (!allDates.length) {
        clearChart();
        clearDetails();
        const quote = symbol.latestQuote || {};
        setText(nodes.name, `${symbol.name || symbol.code} · ${symbol.code}`);
        setText(nodes.price, priceText(quote.price));
        setText(nodes.change, percentText(quote.changePercent));
        nodes.change?.classList.toggle('quote-up', number(quote.changePercent) >= 0);
        nodes.change?.classList.toggle('quote-down', number(quote.changePercent) < 0);
        setText(nodes.holders, '待采集');
        setText(nodes.estimate, '待采集');
        setText(nodes.ratio, '--');
        setText(nodes.confidence, '目录数据');
        setText(nodes.detailPrice, priceText(quote.price));
        setText(nodes.detailChange, percentText(quote.changePercent));
        setText(nodes.detailAmount, quote.amount === undefined ? '--' : `${exactText(quote.amount)} 元`);
        setText(nodes.detailTurnover, quote.turnoverRate === undefined ? '--' : `${Number(quote.turnoverRate).toFixed(2)}%`);
        setLink(nodes.universeSource, state.universeSource);
        setText(nodes.methodology, symbol.realtime ? '实时行情已接入；股东户数属于低频披露数据，当前股票尚未纳入历史股东户数采集。' : '已找到全市场股票目录，但这只股票尚未接入实时行情。');
        setText(nodes.detailSourceStatus, '目录已更新 · 趋势待采集');
        setLink(nodes.universeSource, state.universeSource);
        setLink(nodes.quoteSource, symbol.sourceStatus?.quoteUrl);
        setLink(nodes.priceSource, symbol.sourceStatus?.pricesUrl);
        setStatus(symbol.realtime ? '实时行情已接入 · 分时数据暂不可用' : '已找到 · 正在等待实时行情');
        state.view = undefined;
        return;
      }
      const end = Math.max(...allDates);
      // Price history is intentionally limited to three years. For “全部”, use
      // the overlapping window so a decades-long holder history does not squash
      // the price line into the last few pixels of the chart.
      const overlapStart = Math.max(priceDates.length ? Math.min(...priceDates) : -Infinity, holderDates.length ? Math.min(...holderDates) : -Infinity);
      const start = rangeStart(end, state.range) ?? (Number.isFinite(overlapStart) ? overlapStart : Math.min(...allDates));
      const visiblePrices = prices.filter((point) => dateValue(point.date) >= start && dateValue(point.date) <= end);
      const visibleHolders = holders.filter((point) => dateValue(point.date) >= start && dateValue(point.date) <= end);
      // Keep one disclosure immediately before a short range as context. This
      // makes a three-month view useful even when the latest report is quarterly.
      const contextHolder = holders.filter((point) => dateValue(point.date) < start).slice(-1);
      const plotPrices = visiblePrices.length ? visiblePrices : prices.slice(-1);
      const plotHolders = contextHolder.concat(visibleHolders.length ? visibleHolders : holders.slice(-1));
      const priceDomain = scale(plotPrices.map((point) => point.close), [0, 1]);
      const holderDomain = scale(plotHolders.flatMap((point) => [point.shareholderAccounts, point.estimatedRetailAccounts]), [0, 1]);
      const xFor = (date) => { const timestamp = dateValue(date); return end === start ? width / 2 : Math.max(0, Math.min(width, ((timestamp - start) / (end - start)) * width)); };
      const yPrice = (value) => plotBottom - ((value - priceDomain[0]) / (priceDomain[1] - priceDomain[0])) * height;
      const yHolder = (value) => plotBottom - ((value - holderDomain[0]) / (holderDomain[1] - holderDomain[0])) * height;
      const pricePath = pathFor(plotPrices, 'close', xFor, yPrice);
      const holderPath = pathFor(plotHolders, 'shareholderAccounts', xFor, yHolder);
      const estimatePath = pathFor(plotHolders, 'estimatedRetailAccounts', xFor, yHolder);
      nodes.priceLine?.setAttribute('d', pricePath);
      nodes.priceArea?.setAttribute('d', pricePath ? `${pricePath} L ${xFor(plotPrices[plotPrices.length - 1].date).toFixed(2)} ${plotBottom} L ${xFor(plotPrices[0].date).toFixed(2)} ${plotBottom} Z` : '');
      nodes.holderLine?.setAttribute('d', holderPath);
      nodes.estimateLine?.setAttribute('d', estimatePath);
      nodes.holderDots?.replaceChildren();
      nodes.estimateDots?.replaceChildren();
      nodes.disclosureLines?.replaceChildren();
      plotHolders.forEach((point) => {
        const x = xFor(point.date);
        const holderDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        holderDot.setAttribute('cx', x.toFixed(2)); holderDot.setAttribute('cy', yHolder(point.shareholderAccounts).toFixed(2)); holderDot.setAttribute('r', '3');
        nodes.holderDots?.append(holderDot);
        if (number(point.estimatedRetailAccounts) !== undefined) {
          const estimateDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          estimateDot.setAttribute('cx', x.toFixed(2)); estimateDot.setAttribute('cy', yHolder(point.estimatedRetailAccounts).toFixed(2)); estimateDot.setAttribute('r', '2.4');
          nodes.estimateDots?.append(estimateDot);
        }
        const disclosure = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        disclosure.setAttribute('x1', x.toFixed(2)); disclosure.setAttribute('x2', x.toFixed(2)); disclosure.setAttribute('y1', String(plotTop)); disclosure.setAttribute('y2', String(plotBottom));
        nodes.disclosureLines?.append(disclosure);
      });
      setText(nodes.priceMax, priceText(priceDomain[1])); setText(nodes.priceMin, priceText(priceDomain[0]));
      setText(nodes.holderMax, compact(holderDomain[1])); setText(nodes.holderMin, compact(holderDomain[0]));
      const quote = symbol.latestQuote || {};
      const latestPrice = number(quote.price) ?? number(plotPrices[plotPrices.length - 1]?.close);
      const latestHolder = (holders[holders.length - 1] || plotHolders[plotHolders.length - 1]);
      setText(nodes.name, `${symbol.name || symbol.code} · ${symbol.code}`);
      setText(nodes.price, priceText(latestPrice));
      setText(nodes.change, percentText(quote.changePercent));
      nodes.change?.classList.toggle('quote-up', number(quote.changePercent) >= 0);
      nodes.change?.classList.toggle('quote-down', number(quote.changePercent) < 0);
      setText(nodes.holders, compact(latestHolder?.shareholderAccounts));
      setText(nodes.estimate, compact(latestHolder?.estimatedRetailAccounts));
      setText(nodes.ratio, latestHolder?.estimatedRetailRatio === undefined ? '--' : `${(latestHolder.estimatedRetailRatio * 100).toFixed(1)}%`);
      setText(nodes.confidence, confidenceText(latestHolder?.confidence));
      setText(nodes.asof, latestHolder?.asOf ? dateText(latestHolder.asOf) : '--');
      setText(nodes.averageShares, compact(latestHolder?.averageFreeShares));
      setText(nodes.detailPrice, priceText(latestPrice));
      setText(nodes.detailChange, percentText(quote.changePercent));
      setText(nodes.detailAmount, quote.amount === undefined ? '--' : `${exactText(quote.amount)} 元`);
      setText(nodes.detailTurnover, quote.turnoverRate === undefined ? '--' : `${Number(quote.turnoverRate).toFixed(2)}%`);
      setText(nodes.detailHolder, exactText(latestHolder?.shareholderAccounts));
      setText(nodes.detailEstimate, exactText(latestHolder?.estimatedRetailAccounts));
      setText(nodes.detailRatio, latestHolder?.estimatedRetailRatio === undefined ? '--' : `${(latestHolder.estimatedRetailRatio * 100).toFixed(1)}%`);
      setText(nodes.detailInstitution, exactText(latestHolder?.identifiableInstitutionAccounts));
      setText(nodes.detailCorporate, exactText(latestHolder?.identifiableCorporateAccounts));
      setText(nodes.detailTop10, exactText(latestHolder?.top10NonRetailAccounts));
      setText(nodes.detailAsOf, latestHolder?.asOf ? dateText(latestHolder.asOf) : '--');
      setText(nodes.detailNotice, latestHolder?.noticeDate ? dateText(latestHolder.noticeDate) : '--');
      setText(nodes.detailAverageShares, exactText(latestHolder?.averageFreeShares));
      setText(nodes.detailAverageAmount, latestHolder?.averageHoldAmount === undefined ? '--' : `${exactText(latestHolder.averageHoldAmount)} 元`);
      setText(nodes.detailConcentration, latestHolder?.concentration || '--');
      setText(nodes.detailCoverage, `${symbol.realtime && !plotHolders.length ? `${plotPrices.length} 个分时点` : `${plotPrices.length} 个交易日`} / ${plotHolders.length} 次披露`);
      setText(nodes.detailSourceStatus, symbol.realtime ? `实时行情 · ${dateText(symbol.sourceStatus?.fetchedAt)}` : `${symbol.sourceStatus?.currentRun === 'ok' ? '采集成功' : '数据降级'} · ${state.generatedAt ? dateText(state.generatedAt) : '--'}`);
      setLink(nodes.holderSource, latestHolder?.sourceUrl);
      setLink(nodes.universeSource, state.universeSource);
      setLink(nodes.priceSource, symbol.sourceStatus?.pricesUrl);
      setLink(nodes.quoteSource, symbol.sourceStatus?.quoteUrl);
      const correlationPairs = plotHolders.map((holder) => nearest(plotPrices, dateValue(holder.date))?.close);
      const corr = correlation(plotHolders.map((point) => point.estimatedRetailAccounts), correlationPairs);
      setText(nodes.correlation, corr === undefined ? '样本不足' : `${corr >= 0 ? '+' : ''}${corr.toFixed(2)}`);
      const intervals = plotHolders.slice(1).map((point, index) => (dateValue(point.date) - dateValue(plotHolders[index].date)) / 86400000).filter((value) => value > 0);
      const median = intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)];
      setText(nodes.frequency, median === undefined ? '待积累' : median > 75 ? '季度披露' : median > 35 ? '月度披露' : '不定期');
      const generated = state.generatedAt ? ` · 更新 ${dateText(state.generatedAt)}` : '';
      const methodology = symbol.realtime && !plotHolders.length
        ? '实时行情来自东方财富报价与分时接口，页面约每 5 秒刷新；股东户数属于定期披露数据，当前股票暂未采集历史股东户数。'
        : `${state.methodology?.formula || '股东户数代理值'}。${state.methodology?.disclaimer || '不是实际散户人数'}${generated}`;
      setText(nodes.methodology, methodology);
      setStatus(symbol.realtime && !plotHolders.length ? `${plotPrices.length} 个实时分时点 · 股东户数历史待采集` : `${plotPrices.length} 个交易日 · ${plotHolders.length} 次披露`);
      state.view = { plotPrices, plotHolders, start, end, xFor, yPrice };
    }

    function showTooltip(event) {
      if (!state.view) return;
      const rect = chartWrap.getBoundingClientRect();
      const x = Math.max(0, Math.min(width, ((event.clientX - rect.left) / rect.width) * width));
      const timestamp = state.view.start + (x / width) * (state.view.end - state.view.start);
      const pricePoint = nearest(state.view.plotPrices, timestamp);
      const holderPoint = nearest(state.view.plotHolders, timestamp);
      const holderDistance = holderPoint ? Math.abs(dateValue(holderPoint.date) - timestamp) : Infinity;
      const priceDistance = pricePoint ? Math.abs(dateValue(pricePoint.date) - timestamp) : Infinity;
      const activePrice = priceDistance <= holderDistance || !holderPoint ? pricePoint : nearest(state.view.plotPrices, dateValue(holderPoint.date));
      if (!activePrice) return;
      const cursorX = state.view.xFor(activePrice.date);
      nodes.cursorX?.setAttribute('x1', String(cursorX)); nodes.cursorX?.setAttribute('x2', String(cursorX)); nodes.cursorX?.style.setProperty('opacity', '1');
      nodes.cursorDot?.setAttribute('cx', String(cursorX)); nodes.cursorDot?.setAttribute('cy', String(state.view.yPrice(activePrice.close))); nodes.cursorDot?.style.setProperty('opacity', '1');
      const holder = nearest(state.view.plotHolders, dateValue(activePrice.date));
      if (nodes.tooltip) {
        nodes.tooltip.hidden = false;
        nodes.tooltip.replaceChildren();
        const date = document.createElement('small'); date.textContent = dateText(activePrice.date);
        const price = document.createElement('b'); price.textContent = `股价 ${priceText(activePrice.close)}`;
        const accounts = document.createElement('span'); accounts.textContent = holder ? `账户 ${compact(holder.shareholderAccounts)} · 代理 ${compact(holder.estimatedRetailAccounts)}` : '该日无股东户数披露';
        nodes.tooltip.append(date, price, accounts);
        const tooltipWidth = 150;
        nodes.tooltip.style.left = `${Math.max(8, Math.min(rect.width - tooltipWidth, (event.clientX - rect.left) + 14))}px`;
        nodes.tooltip.style.top = `${Math.max(10, (event.clientY - rect.top) - 24)}px`;
      }
    }

    async function init() {
      try {
        const [response, universeResponse] = await Promise.all([
          fetch('data/retail/index.json', { cache: 'no-store' }),
          fetch('data/retail/universe.json', { cache: 'no-store' }).catch(() => undefined)
        ]);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const universePayload = universeResponse?.ok ? await universeResponse.json() : { stocks: [] };
        state.symbols = Array.isArray(payload.symbols) ? payload.symbols : [];
        const trendCodes = new Set(state.symbols.map((symbol) => symbol.code));
        const directory = Array.isArray(universePayload.stocks) ? universePayload.stocks : [];
        state.searchSymbols = directory.length
          ? directory.map((symbol) => ({ ...symbol, dataReady: trendCodes.has(symbol.code) }))
          : state.symbols.map((symbol) => ({ ...symbol, dataReady: true }));
        state.generatedAt = payload.generatedAt;
        state.methodology = payload.methodology || {};
        state.universeSource = universePayload.sourceUrl;
        if (!state.searchSymbols.length) { clearChart(); setStatus('暂无股票目录，请稍后刷新'); setText(nodes.methodology, '全市场股票目录尚未生成，请稍后刷新页面。'); return; }
        void selectSymbol(state.searchSymbols.find((symbol) => symbol.dataReady) || state.searchSymbols[0]);
      } catch (error) {
        clearChart();
        setStatus('数据读取失败');
        setText(nodes.methodology, '暂时无法读取静态数据，请检查网络或稍后刷新页面。');
        console.warn('[retail dashboard]', error);
      }
    }

    search.addEventListener('input', () => renderSuggestions(search.value));
    search.addEventListener('focus', () => renderSuggestions(search.value));
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { suggestions.classList.remove('open'); search.blur(); }
      if (event.key === 'Enter') { const first = suggestions.querySelector('button'); if (first) { event.preventDefault(); const symbol = state.searchSymbols.find((item) => item.code === first.dataset.code); if (symbol) void selectSymbol(symbol); } }
    });
    suggestions.addEventListener('click', (event) => { const button = event.target.closest('button'); const symbol = state.searchSymbols.find((item) => item.code === button?.dataset.code); if (symbol) void selectSymbol(symbol); });
    document.addEventListener('pointerdown', (event) => { if (!search.closest('.retail-search')?.contains(event.target)) suggestions.classList.remove('open'); });
    document.querySelectorAll('[data-retail-range]').forEach((button) => button.addEventListener('click', () => { state.range = button.dataset.retailRange || 'all'; document.querySelectorAll('[data-retail-range]').forEach((item) => item.classList.toggle('active', item === button)); render(); }));
    chartWrap.addEventListener('pointermove', showTooltip, { passive: true });
    chartWrap.addEventListener('pointerleave', () => { nodes.cursorX?.style.setProperty('opacity', '0'); nodes.cursorDot?.style.setProperty('opacity', '0'); if (nodes.tooltip) nodes.tooltip.hidden = true; }, { passive: true });
    window.setInterval(() => { void refreshCurrentRealtime(); }, realtimeRefreshMs);
    init();
    return { render };
  })();

  window.addEventListener('beforeunload', () => cancelAnimationFrame(frame));
})();
