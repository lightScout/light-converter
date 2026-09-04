<script lang="ts">
  import { onMount } from 'svelte';
  import { getBatch, runLocal, createBatch, upsert, urlFor, type Batch } from '../lib/batches';
  import { onStatus, type RemoverStatus } from '../lib/remover';
  import { downloadBatch, downloadImage } from '../lib/download';
  import Loader from '../components/Loader.svelte';

  let batch = $state<Batch | null>(null);
  let missing = $state(false);
  let stop: (() => void) | null = null;
  let model = $state<RemoverStatus>({ state: 'idle' });

  const done = $derived(batch ? batch.images.filter(i => i.state === 'done').length : 0);
  const total = $derived(batch?.images.length ?? 0);
  const held = $derived(batch ? batch.images.reduce((s, i) => s + i.cost, 0) : 0);

  function start(b: Batch) {
    batch = b;
    if (b.images.some(i => i.state !== 'done')) {
      stop?.();
      stop = runLocal(b, (nb) => { batch = { ...nb }; });
    }
  }

  onMount(() => {
    let offStatus = () => {};
    (async () => {
      const id = new URLSearchParams(location.search).get('id');
      const b = id ? await getBatch(id) : undefined;
      if (!b) { missing = true; return; }
      start(b);
      offStatus = onStatus(s => { model = s; });
    })();

    const drop = async (e: DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length || !batch) return;
      const extra = await createBatch(files);
      batch.images.push(...extra.images);
      await upsert(batch);
      start(batch);
    };
    const over = (e: DragEvent) => e.preventDefault();
    document.addEventListener('dragover', over);
    document.addEventListener('drop', drop);
    return () => { stop?.(); offStatus(); document.removeEventListener('dragover', over); document.removeEventListener('drop', drop); };
  });

  let zipping = $state(false);
  async function download() {
    if (!batch || zipping) return;
    zipping = true;
    try { await downloadBatch(batch); } finally { zipping = false; }
  }
</script>

{#if missing}
  <header class="head">
    <h1 class="display title">No batch here.</h1>
    <p class="dim sub"><a class="cta" href="/app">Drop images on Home</a></p>
  </header>
{:else if batch}
  <header class="head">
    <div>
      <h1>
        <span class="display title">{batch.name}</span>
        <span class="accent count">{done} of {total}</span>
      </h1>
      <p class="dim sub label">
        {batch.format} · {batch.size} · {held} Light
        {#if model.state === 'ready'}
          <span> · {model.model} · {model.backend}</span>
        {:else if model.state === 'error'}
          <span class="gold"> · model failed: {model.message}</span>
        {/if}
      </p>
      {#if model.state === 'loading'}
        <div class="load"><Loader label="Loading model" progress={model.total ? (model.loaded ?? 0) / model.total : null} /></div>
      {/if}
    </div>
    {#if done > 0}
      <button class="bevel light act" onclick={download} disabled={zipping}><i class="glyph"></i>{zipping ? 'Zipping…' : `Download ${done === total ? 'all' : `${done} ready`}`}</button>
    {/if}
  </header>

  <ul class="grid">
    {#each batch.images as img, i (img.id)}
      <li class="tile" class:done={img.state === 'done'} class:queued={img.state === 'queued'} class:failed={img.state === 'failed'}>
        <span class="label idx sq">{String(i + 1).padStart(3, '0')}</span>
        {#if img.state === 'done'}
          <div class="checker result" style={`background-image:url(${urlFor(img.result)})`}></div>
          <div class="reveal" aria-hidden="true"></div>
          <button class="dl" onclick={() => downloadImage(img)} aria-label={`Download ${img.name}`}>Download</button>
        {:else}
          <div class="orig" style={`background-image:url(${urlFor(img.src)})`}></div>
          {#if img.state !== 'queued'}
            <span class="ring" aria-hidden="true"></span>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 40px; }
  h1 { display: flex; align-items: baseline; gap: 28px; flex-wrap: wrap; }
  .title { font-size: 40px; font-weight: 300; letter-spacing: -0.02em; }
  .count { font-size: 34px; transition: text-shadow 300ms; }
  .head:has(.tile) .count { }
  .sub { margin-top: 12px; }
  .load { margin-top: 18px; color: var(--muted); }
  .act { margin-top: 10px; white-space: nowrap; }
  .act:disabled { opacity: 0.5; }

  .grid {
    list-style: none; margin: 56px 0 0; padding: 0;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 32px;
  }
  .tile {
    position: relative; aspect-ratio: 1; border-radius: 18px; overflow: hidden;
    --cut: 18px;
    clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut));
    background: rgba(var(--glow), 0.02);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
    transition: box-shadow 300ms, background 300ms;
  }
  .tile.queued { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05); }
  .tile.failed { box-shadow: inset 0 0 0 1px rgba(241, 213, 155, 0.35); }
  .tile.done { background: none; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.10), 0 0 48px rgba(var(--glow), 0.06); animation: land 700ms var(--ease); }
  @keyframes land { from { opacity: 0; transform: scale(0.98); } }
  .idx { position: absolute; right: 14px; top: 12px; z-index: 2; color: var(--dim); font-size: 10px; }
  .tile.done .idx { color: #4b5a86; }
  .reveal { position: absolute; inset: 0; overflow: hidden; pointer-events: none; border-radius: inherit; }

  .result, .orig { position: absolute; inset: 0; background-size: contain; background-position: center; background-repeat: no-repeat; }
  .result { background-size: contain; opacity: 0.94; }
  .orig { opacity: 0.16; background-size: cover; filter: saturate(0.5) blur(0.5px); }
  .checker { background-color: rgba(244, 244, 247, 0.92); }
  .dl {
    position: absolute; left: 0; right: 0; bottom: 0;
    padding: 12px 0 14px;
    font-size: 13px; font-weight: 500; color: var(--text);
    background: linear-gradient(to top, rgba(10, 16, 41, 0.85), rgba(10, 16, 41, 0));
    opacity: 0; transform: translateY(6px);
    transition: opacity 180ms ease, transform 220ms var(--ease);
  }
  .tile:hover .dl, .tile:focus-within .dl { opacity: 1; transform: none; }
  /* One loader: a point of light travelling around the card's edge. */
  .ring {
    position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
    padding: 1.5px;
    background: conic-gradient(from var(--a, 0deg), transparent 0 62%, rgba(var(--glow), 0.25) 78%, rgba(var(--glow), 1) 92%, transparent 100%);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude;
    filter: drop-shadow(0 0 6px rgba(var(--glow), 0.7));
    animation: orbit 2.2s linear infinite;
  }
  @property --a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
  @keyframes orbit { to { --a: 360deg; } }
</style>
