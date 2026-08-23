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

  window.addEventListener('beforeunload', () => cancelAnimationFrame(frame));
})();
