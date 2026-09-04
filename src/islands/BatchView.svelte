<script lang="ts">
  import { onMount } from 'svelte';
  import { getBatch, runLocal, createBatch, upsert, type Batch } from '../lib/batches';
  import { onStatus, type RemoverStatus } from '../lib/remover';
  import { downloadBatch, downloadImage } from '../lib/download';

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
    const id = new URLSearchParams(location.search).get('id');
    const b = id ? getBatch(id) : null;
    if (!b) { missing = true; return; }
    start(b);
    const offStatus = onStatus(s => { model = s; });

    const drop = async (e: DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length || !batch) return;
      const extra = await createBatch(files);
      batch.images.push(...extra.images);
      upsert(batch);
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
      <p class="dim sub">
        {batch.format} · {batch.size} · {held} Light
        {#if model.state === 'loading'}
          <span class="gold"> · loading model{model.total ? ` ${Math.round((model.loaded ?? 0) / model.total * 100)}%` : '…'}</span>
        {:else if model.state === 'ready'}
          <span> · on this device ({model.model} · {model.backend})</span>
        {:else if model.state === 'error'}
          <span class="gold"> · model failed: {model.message}</span>
        {/if}
      </p>
    </div>
    {#if done > 0}
      <button class="cta act" onclick={download} disabled={zipping}>{zipping ? 'Zipping…' : `Download ${done === total ? 'all' : `${done} ready`}`}</button>
    {/if}
  </header>

  <ul class="grid">
    {#each batch.images as img (img.id)}
      <li class="tile" class:done={img.state === 'done'} class:queued={img.state === 'queued'} class:failed={img.state === 'failed'}>
        {#if img.state === 'done'}
          <div class="checker result" style={`background-image:url(${img.result})`}></div>
          <button class="dl" onclick={() => downloadImage(img)} aria-label={`Download ${img.name}`}>Download</button>
        {:else}
          <div class="orig" style={`background-image:url(${img.src})`}></div>
          {#if img.state !== 'queued'}
            <span class="bar" style={`transform:scaleX(${img.progress})`}></span>
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
  .count { font-size: 34px; }
  .sub { margin-top: 10px; font-size: 13px; }
  .act { font-size: 16px; margin-top: 14px; white-space: nowrap; }

  .grid {
    list-style: none; margin: 56px 0 0; padding: 0;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 32px;
  }
  .tile {
    position: relative; aspect-ratio: 1; border-radius: 16px; overflow: hidden;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
    transition: box-shadow 300ms;
  }
  .tile.queued { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06); }
  .tile.failed { box-shadow: inset 0 0 0 1px rgba(232, 199, 122, 0.35); }
  .tile.done { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.10); animation: land 600ms var(--ease); }
  @keyframes land { from { opacity: 0; transform: scale(0.98); } }

  .result, .orig { position: absolute; inset: 0; background-size: contain; background-position: center; background-repeat: no-repeat; }
  .result { background-size: contain; }
  .orig { opacity: 0.35; background-size: cover; filter: saturate(0.6); }
  .dl {
    position: absolute; left: 0; right: 0; bottom: 0;
    padding: 12px 0 14px;
    font-size: 13px; font-weight: 500; color: var(--text);
    background: linear-gradient(to top, rgba(10, 16, 41, 0.85), rgba(10, 16, 41, 0));
    opacity: 0; transform: translateY(6px);
    transition: opacity 180ms ease, transform 220ms var(--ease);
  }
  .tile:hover .dl, .tile:focus-within .dl { opacity: 1; transform: none; }
  .bar {
    position: absolute; left: 0; right: 0; bottom: 0; height: 1px;
    transform-origin: left;
    background: linear-gradient(90deg, var(--gold), var(--lavender));
    transition: transform 120ms linear;
  }
</style>
