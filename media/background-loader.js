(() => {
  if (globalThis.__aStockWatchBackground) return;
  globalThis.__aStockWatchBackground = true;
  const token = '__TOKEN__';
  const portStart = __PORT_START__;
  const portEnd = __PORT_END__;
  let state;
  let activePort;
  const canvases = new Map();

  const style = document.createElement('style');
  style.textContent = '.a-stock-watch-background{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5}.monaco-editor .view-lines,.monaco-editor .margin-view-overlays{position:relative;z-index:6}';
  document.head.appendChild(style);

  async function poll() {
    const ports = activePort ? [activePort] : Array.from({length: portEnd-portStart+1}, (_, i) => portStart+i);
    for (const port of ports) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/${token}/state`, { cache: 'no-store' });
        if (!response.ok) continue;
        state = await response.json(); activePort = port; sync(); drawAll(); return;
      } catch { /* probe next */ }
    }
    activePort = undefined;
  }

  function sync() {
    document.querySelectorAll('.monaco-editor').forEach((host) => {
      if (canvases.has(host)) return;
      const canvas = document.createElement('canvas');
      canvas.className = 'a-stock-watch-background'; host.appendChild(canvas); canvases.set(host, canvas);
      new ResizeObserver(() => draw(canvas)).observe(host);
    });
    for (const [host] of canvases) if (!host.isConnected) canvases.delete(host);
  }

  function drawAll() { canvases.forEach(draw); }
  function draw(canvas) {
    const points = state?.intraday || []; if (!points.length) return;
    const options = state.background || { opacity:.12, showAverage:true, showVolume:false, lineWidth:1.5 };
    const rect = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    canvas.width = Math.max(1, rect.width*dpr); canvas.height = Math.max(1, rect.height*dpr);
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,rect.width,rect.height); ctx.globalAlpha = options.opacity;
    const prev = state.previousClose || points[0].price; const prices = points.flatMap(p => [p.price,p.averagePrice]);
    const delta = Math.max(...prices.map(p => Math.abs(p-prev)), prev*.005); const min=prev-delta*1.08,max=prev+delta*1.08;
    const x=i=>i/Math.max(1,points.length-1)*rect.width, y=p=>(max-p)/(max-min)*rect.height;
    line('price', points.at(-1).price>=prev?'#f14c4c':'#89d185', options.lineWidth, x,y,ctx,points);
    if(options.showAverage) line('averagePrice','#d7ba7d',Math.max(1,options.lineWidth*.75),x,y,ctx,points);
    ctx.globalAlpha=1;
  }
  function line(field,color,width,x,y,ctx,points){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(x(i),y(p[field])):ctx.moveTo(x(i),y(p[field])));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  new MutationObserver(() => { sync(); drawAll(); }).observe(document.body,{childList:true,subtree:true});
  sync(); void poll(); setInterval(poll,5000);
})();

