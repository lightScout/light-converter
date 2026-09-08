<script lang="ts">
  /* Preview and edit for one cutout.
     Preview: the result large, on a backdrop of your choice, hold to compare with the original.
     Edit:    paint the mask — restore what the model cut, erase what it kept — then apply. */
  import { onMount } from 'svelte';
  import { urlFor, type BatchImage } from '../lib/batches';
  import { downloadImage } from '../lib/download';
  import { removeBackground, type RunParams } from '../lib/remover';

  let { image, mode = 'preview', onclose, onsave }: { image: BatchImage; mode?: 'preview' | 'edit'; onclose: () => void; onsave: (result: Blob) => void } = $props();

  type Back = 'checker' | 'white' | 'black' | 'navy';
  let back = $state<Back>('checker');
  let compare = $state(false);
  let tool = $state<'restore' | 'erase'>('restore');
  let size = $state(48);
  let hardness = $state(60);      // 0 soft … 100 hard edge
  let strength = $state(100);     // how much one pass applies
  let dirty = $state(false);
  let saving = $state(false);
  let undo: ImageData[] = [];
  let canUndo = $state(false);
  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let panning = false, panLast: [number, number] | null = null, space = false;
  // model knobs — defaults reproduce the batch run
  let showModel = $state(false);
  let running = $state(false);
  let params = $state<Required<RunParams>>({ sensitivity: 0, secondLook: 'auto', boost: 2.5, cleanup: 'normal', fillHoles: true, edge: 1 });
  async function rerun() {
    if (running) return;
    running = true;
    try {
      const blob = await removeBackground(image.src, { ...params });
      const bmp = await createImageBitmap(blob);
      snapshot(); ctx.clearRect(0, 0, W, H); ctx.drawImage(bmp, 0, 0); bmp.close(); dirty = true;
    } catch (e) { console.error('[viewer] rerun failed', e); }
    finally { running = false; }
  }

  let canvas: HTMLCanvasElement;                   // the working result (edited in place)
  let cursor: HTMLDivElement;
  let stage: HTMLDivElement;
  let W = 0, H = 0;
  let orig: ImageBitmap | null = null;             // original pixels, for restore
  let origData: ImageData | null = null;
  let ctx: CanvasRenderingContext2D;
  let painting = false, last: [number, number] | null = null;

  onMount(() => {
    let cancelled = false;
    (async () => {
      const res = await createImageBitmap(image.result!);
      orig = await createImageBitmap(image.src);
      if (cancelled) return;
      W = res.width; H = res.height;
      canvas.width = W; canvas.height = H;
      ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(res, 0, 0);
      const oc = document.createElement('canvas'); oc.width = W; oc.height = H;
      const octx = oc.getContext('2d')!; octx.drawImage(orig, 0, 0, W, H);
      origData = octx.getImageData(0, 0, W, H);
      res.close();
    })();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onclose();
      if (mode === 'edit') { if (e.key === 'e') tool = 'erase'; if (e.key === 'r') tool = 'restore'; if (e.key === '[') size = Math.max(6, size - 8); if (e.key === ']') size = Math.min(300, size + 8); if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undoOnce(); } }
      if (e.key === ' ') { if (mode === 'edit') space = e.type === 'keydown'; else compare = e.type === 'keydown'; e.preventDefault(); }
      if (mode === 'edit' && e.type === 'keydown') { if (e.key === '=' || e.key === '+') setZoom(zoom * 1.25); if (e.key === '-') setZoom(zoom / 1.25); if (e.key === '0') { zoom = 1; pan = { x: 0, y: 0 }; } }
    };
    addEventListener('keydown', key); addEventListener('keyup', key);
    return () => { cancelled = true; removeEventListener('keydown', key); removeEventListener('keyup', key); orig?.close(); };
  });

  function setZoom(z: number, cx?: number, cy?: number) {
    const nz = Math.min(8, Math.max(1, z));
    if (cx !== undefined && cy !== undefined) { const r = stage.getBoundingClientRect(); const ox = cx - (r.left + r.width / 2) - pan.x, oy = cy - (r.top + r.height / 2) - pan.y; const k = nz / zoom; pan = { x: pan.x - ox * (k - 1), y: pan.y - oy * (k - 1) }; }
    zoom = nz; if (zoom === 1) pan = { x: 0, y: 0 };
  }
  function wheel(e: WheelEvent) { if (mode !== 'edit') return; e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY); }

  /* canvas-space point from a pointer event */
  function pt(e: PointerEvent): [number, number] {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H];
  }
  function snapshot() { undo.push(ctx.getImageData(0, 0, W, H)); if (undo.length > 12) undo.shift(); canUndo = true; }
  function undoOnce() { const d = undo.pop(); if (d) { ctx.putImageData(d, 0, 0); canUndo = undo.length > 0; dirty = true; } }

  /* paint one dab: soft round brush. restore = copy original pixels back with full alpha; erase = alpha to 0 */
  function dab(x: number, y: number) {
    const r = size / 2 * (W / canvas.getBoundingClientRect().width);
    const x0 = Math.max(0, Math.floor(x - r)), y0 = Math.max(0, Math.floor(y - r)), x1 = Math.min(W - 1, Math.ceil(x + r)), y1 = Math.min(H - 1, Math.ceil(y + r));
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const d = ctx.getImageData(x0, y0, w, h), p = d.data, o = origData!.data;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const dx = x0 + xx - x, dy = y0 + yy - y, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > r) continue;
      const soft = Math.max(0.02, 1 - hardness / 100);               // fraction of the radius that feathers
      const k = Math.min(1, (r - dist) / (r * soft)) * (strength / 100);
      const i = (yy * w + xx) * 4, j = ((y0 + yy) * W + (x0 + xx)) * 4;
      if (tool === 'restore') {
        const a = p[i + 3] / 255, na = a + (1 - a) * k;
        p[i] = o[j]; p[i + 1] = o[j + 1]; p[i + 2] = o[j + 2]; p[i + 3] = Math.round(na * 255);
      } else {
        p[i + 3] = Math.round(p[i + 3] * (1 - k));
      }
    }
    ctx.putImageData(d, x0, y0);
  }
  function stroke(a: [number, number], b: [number, number]) {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (size * 0.12)));
    for (let i = 0; i <= n; i++) dab(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n);
  }
  function down(e: PointerEvent) {
    if (mode !== 'edit' || !origData) return;
    if (space || e.button === 1) { panning = true; panLast = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); return; }
    snapshot(); painting = true; dirty = true; last = pt(e); dab(...last); canvas.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    if (panning && panLast) { pan = { x: pan.x + e.clientX - panLast[0], y: pan.y + e.clientY - panLast[1] }; panLast = [e.clientX, e.clientY]; return; }
    if (!painting || !last) return;
    const p = pt(e); stroke(last, p); last = p;
  }
  function up() { painting = false; last = null; panning = false; panLast = null; }

  async function apply() {
    saving = true;
    const blob = await new Promise<Blob>(res => canvas.toBlob(b => res(b!), 'image/png'));
    onsave(blob); saving = false; dirty = false;
  }
  function download() { downloadImage(image); }
</script>

<div class="viewer" role="dialog" aria-label={image.name}>
  <header class="top">
    <span class="label dim">{image.name}</span>
    <nav>
      <button class="label" class:on={mode === 'preview'} onclick={() => mode = 'preview'}>Preview</button>
      <button class="label" class:on={mode === 'edit'} onclick={() => mode = 'edit'}>Edit</button>
      <button class="label" onclick={download}>Download</button>
      <button class="label" onclick={onclose}>Close</button>
    </nav>
  </header>

  <div class="stage" bind:this={stage} class:editing={mode === 'edit'} class:compare onwheel={wheel}>
    <div class={`board ${back}`} style={`transform: translate(${pan.x}px, ${pan.y}px) scale(${zoom})`}>
      <canvas bind:this={canvas} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onpointerleave={() => cursor.style.opacity = '0'} onpointerenter={() => cursor.style.opacity = mode === 'edit' ? '1' : '0'}></canvas>
      {#if compare}<img class="orig" src={urlFor(image.src)} alt="" />{/if}
    </div>
    <div class={`cursor ${tool}`} bind:this={cursor} style={`width:${size}px;height:${size}px;opacity:0`}><i class="core" style={`inset:${(100 - hardness) / 2}%`}></i><span>{tool === 'restore' ? '+' : '−'}</span></div>
  </div>

  {#if mode === 'edit' && showModel}
    <section class="model" aria-label="Model settings">
      <div class="row">
        <label class="param wide"><span class="label dim">Sensitivity</span><input type="range" min="-100" max="100" value={Math.round(params.sensitivity * 100)} oninput={(e) => params.sensitivity = Number((e.target as HTMLInputElement).value) / 100} /><span class="label val">{params.sensitivity > 0 ? '+' : ''}{Math.round(params.sensitivity * 100)}</span></label>
        <span class="label dim note">− cuts more · + keeps more</span>
      </div>
      <div class="row">
        <span class="label dim">Second look</span>
        <span class="seg">{#each ['auto', 'on', 'off'] as v}<button class="label" class:on={params.secondLook === v} onclick={() => params.secondLook = v as any}>{v}</button>{/each}</span>
        <label class="param"><span class="label dim">Boost</span><input type="range" min="1" max="4" step="0.1" bind:value={params.boost} /><span class="label val">{params.boost.toFixed(1)}</span></label>
        <span class="label dim note">re-reads a contrast-boosted copy for subjects that blend into the background</span>
      </div>
      <div class="row">
        <span class="label dim">Cleanup</span>
        <span class="seg">{#each ['off', 'normal', 'strong'] as v}<button class="label" class:on={params.cleanup === v} onclick={() => params.cleanup = v as any}>{v}</button>{/each}</span>
        <button class="label chk" class:on={params.fillHoles} onclick={() => params.fillHoles = !params.fillHoles}><i></i>Fill holes</button>
        <label class="param"><span class="label dim">Edge detail</span><input type="range" min="0" max="100" value={Math.round(params.edge * 100)} oninput={(e) => params.edge = Number((e.target as HTMLInputElement).value) / 100} /><span class="label val">{Math.round(params.edge * 100)}</span></label>
      </div>
      <div class="row end">
        <button class="label" onclick={() => params = { sensitivity: 0, secondLook: 'auto', boost: 2.5, cleanup: 'normal', fillHoles: true, edge: 1 }}>Reset</button>
        <button class="bevel light" onclick={rerun} disabled={running}><i class="glyph"></i>{running ? 'Running…' : 'Run again'}</button>
      </div>
    </section>
  {/if}

  <footer class="bottom cells">
    {#if mode === 'preview'}
      <span class="label dim">Backdrop</span>
      <span class="chips">
        {#each ['checker', 'white', 'black', 'navy'] as b}
          <button class={`swatch ${b}`} class:on={back === b} onclick={() => back = b as Back} aria-label={b}></button>
        {/each}
      </span>
      <span class="grow"><button class="label" onpointerdown={() => compare = true} onpointerup={() => compare = false} onpointerleave={() => compare = false}>Hold to compare</button></span>
      <span class="label dim">Space · compare</span>
    {:else}
      <span class="tools" role="radiogroup" aria-label="Brush">
        <button class="bevel tool restore" class:light={tool === 'restore'} role="radio" aria-checked={tool === 'restore'} onclick={() => tool = 'restore'}><i class="ico">+</i>Restore</button>
        <button class="bevel tool erase" class:light={tool === 'erase'} role="radio" aria-checked={tool === 'erase'} onclick={() => tool = 'erase'}><i class="ico">−</i>Erase</button>
      </span>
      <span class="label dim hint">{tool === 'restore' ? 'Brings the original back' : 'Removes'}</span>
      <button class="label mdl" class:on={showModel} onclick={() => showModel = !showModel}>Model{running ? ' …' : ''}</button>
      <span class="params">
        <label class="param"><span class="label dim">Size</span><input type="range" min="6" max="300" bind:value={size} /><span class="label val">{size}</span></label>
        <label class="param"><span class="label dim">Hardness</span><input type="range" min="0" max="100" bind:value={hardness} /><span class="label val">{hardness}</span></label>
        <label class="param"><span class="label dim">Strength</span><input type="range" min="5" max="100" bind:value={strength} /><span class="label val">{strength}</span></label>
      </span>
      <span class="zoom"><button class="label" onclick={() => setZoom(zoom / 1.25)} aria-label="Zoom out">−</button><button class="label z" onclick={() => { zoom = 1; pan = { x: 0, y: 0 }; }}>{Math.round(zoom * 100)}%</button><button class="label" onclick={() => setZoom(zoom * 1.25)} aria-label="Zoom in">+</button></span>
      <span class="grow"><button class="label" onclick={undoOnce} disabled={!canUndo}>Undo</button></span>
      <button class="bevel light" onclick={apply} disabled={!dirty || saving}><i class="glyph"></i>{saving ? 'Saving…' : 'Apply'}</button>
    {/if}
  </footer>
</div>

<style>
  .viewer { position: fixed; inset: 0; z-index: 40; background: rgba(3, 10, 24, 0.86); backdrop-filter: blur(16px); display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; grid-template-columns: minmax(0, 1fr); }
  .top { display: flex; align-items: center; justify-content: space-between; padding: 30px 44px 0; }
  .top nav { display: flex; gap: 26px; }
  .top nav button, .bottom button.label, .tool { color: var(--dim); transition: color 200ms; }
  .top nav button:hover, .top nav button.on, .bottom button.label:hover, .tool.on { color: var(--text); }
  .stage { position: relative; display: grid; place-items: center; padding: 24px 44px; overflow: hidden; min-height: 0; }
  .board { position: relative; transform-origin: center; transition: transform 120ms ease-out; max-width: 100%; max-height: 100%; display: grid; place-items: center; --cut: 16px; clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut)); }
  .board.checker { background-color: #f0f0f0; background-image: linear-gradient(45deg, #c9c9c9 25%, transparent 25%), linear-gradient(-45deg, #c9c9c9 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #c9c9c9 75%), linear-gradient(-45deg, transparent 75%, #c9c9c9 75%); background-size: 36px 36px; background-position: 0 0, 0 18px, 18px -18px, -18px 0; }
  .board.white { background: #fff; } .board.black { background: #000; } .board.navy { background: var(--base); }
  canvas { display: block; max-width: 100%; max-height: calc(100vh - 230px); object-fit: contain; touch-action: none; }
  .viewer:has(.model) canvas { max-height: calc(100vh - 400px); }
  .editing canvas { cursor: none; }
  .editing .board { transition: none; }
  .orig { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
  .cursor { position: fixed; left: 0; top: 0; margin: -50% 0 0 -50%; border-radius: 50%; border: 1px solid rgba(var(--glow), 0.9); box-shadow: 0 0 12px rgba(var(--glow), 0.5), inset 0 0 0 1px rgba(3, 10, 24, 0.5); pointer-events: none; opacity: 0; transform: translate(-100px, -100px); }
  .cursor { margin: 0; translate: -50% -50%; display: grid; place-items: center; font-family: var(--font-mono); font-size: 11px; color: var(--text); text-shadow: 0 0 4px rgba(3, 10, 24, 0.9); }
  .cursor .core { position: absolute; border-radius: 50%; border: 1px dashed rgba(var(--glow), 0.55); pointer-events: none; }
  .cursor.restore { border-color: #9cf0c8; box-shadow: 0 0 12px rgba(156, 240, 200, 0.6), inset 0 0 0 1px rgba(3, 10, 24, 0.5); }
  .cursor.erase { border-color: #ff9c9c; box-shadow: 0 0 12px rgba(255, 156, 156, 0.6), inset 0 0 0 1px rgba(3, 10, 24, 0.5); }
  .tools { display: flex; gap: 6px; }
  .tool { padding: 8px 12px; }
  .tool .ico { font-style: normal; font-weight: 700; width: 14px; text-align: center; }
  .tool.restore.light { background: #9cf0c8; }
  .tool.erase.light { background: #ffb3b3; }
  .hint { min-width: 150px; white-space: nowrap; }
  .zoom { display: flex; align-items: center; gap: 10px; }
  .zoom .z { min-width: 44px; text-align: center; }
  .model { margin: 0 15px; padding: 14px 22px; display: grid; gap: 10px; background: rgba(3, 10, 24, 0.7); backdrop-filter: blur(10px); border: 1px solid rgba(var(--glow), 0.10); border-bottom: 0; }
  .model .row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .model .row.end { justify-content: flex-end; }
  .model .wide input { width: 220px; }
  .model .note { color: var(--dim); font-size: 10px; }
  .seg { display: inline-flex; border: 1px solid rgba(var(--glow), 0.14); }
  .seg button { padding: 6px 12px; color: var(--dim); }
  .seg button.on { background: rgba(var(--glow), 0.12); color: var(--text); }
  .chk { display: inline-flex; align-items: center; gap: 8px; color: var(--dim); }
  .chk i { width: 10px; height: 10px; border: 1px solid rgba(var(--glow), 0.4); }
  .chk.on { color: var(--text); } .chk.on i { background: var(--lavender); box-shadow: 0 0 8px rgba(var(--glow), 0.6); }
  .mdl { color: var(--dim); } .mdl.on { color: var(--text); }
  .bottom { margin: 0 15px 15px; color: var(--muted); background: rgba(3, 10, 24, 0.55); min-width: 0; }
  .bottom > * { padding: 0 16px; }
  .bottom .hint { display: none; }
  @media (min-width: 1500px) { .bottom .hint { display: flex; } }
  .chips { display: flex; gap: 10px; }
  .swatch { width: 18px; height: 18px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(var(--glow), 0.25); transition: box-shadow 200ms; }
  .swatch.on { box-shadow: 0 0 0 1px var(--text), 0 0 10px rgba(var(--glow), 0.6); }
  .swatch.checker { background: repeating-conic-gradient(#c9c9c9 0 25%, #f0f0f0 0 50%) 0 0 / 8px 8px; }
  .swatch.white { background: #fff; } .swatch.black { background: #000; } .swatch.navy { background: var(--base); }
  .params { display: flex; gap: 16px; }
  .param { display: flex; align-items: center; gap: 8px; }
  .val { min-width: 26px; text-align: right; color: var(--muted); }
  input[type=range] { width: 84px; accent-color: var(--lavender); }
  .bottom .bevel { margin-left: 8px; }
  button:disabled { opacity: 0.4; }
</style>
