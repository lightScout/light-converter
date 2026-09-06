<script lang="ts">
  /* Preview and edit for one cutout.
     Preview: the result large, on a backdrop of your choice, hold to compare with the original.
     Edit:    paint the mask — restore what the model cut, erase what it kept — then apply. */
  import { onMount } from 'svelte';
  import { urlFor, type BatchImage } from '../lib/batches';
  import { downloadImage } from '../lib/download';

  let { image, mode = 'preview', onclose, onsave }: { image: BatchImage; mode?: 'preview' | 'edit'; onclose: () => void; onsave: (result: Blob) => void } = $props();

  type Back = 'checker' | 'white' | 'black' | 'navy';
  let back = $state<Back>('checker');
  let compare = $state(false);
  let tool = $state<'restore' | 'erase'>('restore');
  let size = $state(48);
  let dirty = $state(false);
  let saving = $state(false);
  let undo: ImageData[] = [];
  let canUndo = $state(false);

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
      if (e.key === ' ') { compare = e.type === 'keydown'; e.preventDefault(); }
    };
    addEventListener('keydown', key); addEventListener('keyup', key);
    return () => { cancelled = true; removeEventListener('keydown', key); removeEventListener('keyup', key); orig?.close(); };
  });

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
      const k = Math.min(1, (r - dist) / (r * 0.25));            // soft edge on the outer quarter
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
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (size * 0.15)));
    for (let i = 0; i <= n; i++) dab(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n);
  }
  function down(e: PointerEvent) { if (mode !== 'edit' || !origData) return; snapshot(); painting = true; dirty = true; last = pt(e); dab(...last); canvas.setPointerCapture(e.pointerId); }
  function move(e: PointerEvent) {
    cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    if (!painting || !last) return;
    const p = pt(e); stroke(last, p); last = p;
  }
  function up() { painting = false; last = null; }

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

  <div class="stage" bind:this={stage} class:editing={mode === 'edit'} class:compare>
    <div class={`board ${back}`}>
      <canvas bind:this={canvas} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onpointerleave={() => cursor.style.opacity = '0'} onpointerenter={() => cursor.style.opacity = mode === 'edit' ? '1' : '0'}></canvas>
      {#if compare}<img class="orig" src={urlFor(image.src)} alt="" />{/if}
    </div>
    <div class="cursor" bind:this={cursor} style={`width:${size}px;height:${size}px`}></div>
  </div>

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
      <button class="label tool" class:on={tool === 'restore'} onclick={() => tool = 'restore'}>Restore</button>
      <button class="label tool" class:on={tool === 'erase'} onclick={() => tool = 'erase'}>Erase</button>
      <span class="size"><span class="label dim">Size</span><input type="range" min="6" max="300" bind:value={size} /></span>
      <span class="grow"><button class="label" onclick={undoOnce} disabled={!canUndo}>Undo</button></span>
      <span class="label dim">R · E · [ ] · ⌘Z</span>
      <button class="bevel light" onclick={apply} disabled={!dirty || saving}><i class="glyph"></i>{saving ? 'Saving…' : 'Apply'}</button>
    {/if}
  </footer>
</div>

<style>
  .viewer { position: fixed; inset: 0; z-index: 40; background: rgba(3, 10, 24, 0.86); backdrop-filter: blur(16px); display: grid; grid-template-rows: auto 1fr auto; }
  .top { display: flex; align-items: center; justify-content: space-between; padding: 30px 44px 0; }
  .top nav { display: flex; gap: 26px; }
  .top nav button, .bottom button.label, .tool { color: var(--dim); transition: color 200ms; }
  .top nav button:hover, .top nav button.on, .bottom button.label:hover, .tool.on { color: var(--text); }
  .stage { position: relative; display: grid; place-items: center; padding: 24px 44px; overflow: hidden; }
  .board { position: relative; max-width: 100%; max-height: calc(100vh - 220px); display: grid; --cut: 16px; clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut)); }
  .board.checker { background-color: #f0f0f0; background-image: linear-gradient(45deg, #c9c9c9 25%, transparent 25%), linear-gradient(-45deg, #c9c9c9 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #c9c9c9 75%), linear-gradient(-45deg, transparent 75%, #c9c9c9 75%); background-size: 36px 36px; background-position: 0 0, 0 18px, 18px -18px, -18px 0; }
  .board.white { background: #fff; } .board.black { background: #000; } .board.navy { background: var(--base); }
  canvas { display: block; max-width: 100%; max-height: calc(100vh - 220px); object-fit: contain; touch-action: none; }
  .editing canvas { cursor: none; }
  .orig { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
  .cursor { position: fixed; left: 0; top: 0; margin: -50% 0 0 -50%; border-radius: 50%; border: 1px solid rgba(var(--glow), 0.9); box-shadow: 0 0 12px rgba(var(--glow), 0.5), inset 0 0 0 1px rgba(3, 10, 24, 0.5); pointer-events: none; opacity: 0; transform: translate(-100px, -100px); }
  .cursor { margin: 0; translate: -50% -50%; }
  .bottom { margin: 0 15px 15px; color: var(--muted); background: rgba(3, 10, 24, 0.55); }
  .chips { display: flex; gap: 10px; }
  .swatch { width: 18px; height: 18px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(var(--glow), 0.25); transition: box-shadow 200ms; }
  .swatch.on { box-shadow: 0 0 0 1px var(--text), 0 0 10px rgba(var(--glow), 0.6); }
  .swatch.checker { background: repeating-conic-gradient(#c9c9c9 0 25%, #f0f0f0 0 50%) 0 0 / 8px 8px; }
  .swatch.white { background: #fff; } .swatch.black { background: #000; } .swatch.navy { background: var(--base); }
  .size { display: flex; align-items: center; gap: 12px; }
  input[type=range] { width: 140px; accent-color: var(--lavender); }
  .bottom .bevel { margin-left: 8px; }
  button:disabled { opacity: 0.4; }
</style>
