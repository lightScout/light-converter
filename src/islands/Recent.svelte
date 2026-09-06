<script lang="ts">
  import { onMount } from 'svelte';
  import { readAll, urlFor, type Batch } from '../lib/batches';

  let { mode = 'thumbs' }: { mode?: 'thumbs' | 'rows' } = $props();
  let batches = $state<Batch[]>([]);
  onMount(async () => { batches = (await readAll()).slice(0, mode === 'rows' ? 40 : 12); });
  // keep the column live while something is processing
  onMount(() => { const id = setInterval(async () => { if (batches.some(b => b.images.some(i => i.state !== 'done'))) batches = (await readAll()).slice(0, mode === 'rows' ? 40 : 12); }, 1500); return () => clearInterval(id); });
  const progress = (b: Batch) => b.images.filter(i => i.state === 'done').length / Math.max(1, b.images.length);

  const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  };
  const summary = (b: Batch) => {
    const done = b.images.filter(i => i.state === 'done').length;
    return done < b.images.length ? `processing · ${done} / ${b.images.length}` : `${b.images.length} · ${ago(b.createdAt)}`;
  };
</script>

{#if batches.length && mode === 'rows'}
  <ul class="rows">
    {#each batches as b, i (b.id)}
      <li>
        <a href={`/app/batch?id=${b.id}`} class="rowlink">
          <span class="thumb sm" style={`background-image:url(${urlFor(b.images[0]?.result ?? b.images[0]?.src)})`}></span>
          <span class="meta"><span class="name">{b.name}</span><span class="sub" class:gold={summary(b).startsWith('processing')} class:dim={!summary(b).startsWith('processing')}>{summary(b)}</span></span>
          <span class="label dim tag">{String(i + 1).padStart(3, '0')} · {b.images.length} img</span>
        </a>
      </li>
    {/each}
  </ul>
{:else if batches.length}
  <section class="recent" aria-label="Recent batches">
    <span class="label sq dim">Recent</span>
    <ul class="col">
      {#each batches as b (b.id)}
        {@const p = progress(b)}
        <li>
          <a href={`/app/batch?id=${b.id}`} class="card" class:busy={p < 1} style={`background-image:url(${urlFor(b.images[0]?.result ?? b.images[0]?.src)})`} aria-label={`${b.name}, ${Math.round(p * 100)}%`}>
            {#if p < 1}
              <span class="ring" aria-hidden="true"></span>
              <i class="bar" style={`transform:scaleX(${p})`}></i>
            {/if}
            <span class="label n">{b.images.length}</span>
          </a>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .rows { list-style: none; margin: 32px 0 0; padding: 0; max-width: 720px; }
  .rows li { border-top: 1px solid rgba(var(--glow), 0.10); }
  .rows li:last-child { border-bottom: 1px solid rgba(var(--glow), 0.10); }
  .rowlink { display: flex; align-items: center; gap: 18px; padding: 16px 8px; transition: background 200ms; }
  .rowlink:hover { background: rgba(var(--glow), 0.04); }
  .thumb.sm { width: 44px; height: 44px; border-radius: 6px; }
  .tag { margin-left: auto; }
  .recent { margin-top: 56px; }
  .col {
    list-style: none; margin: 14px 0 0; padding: 0;
    display: grid; grid-template-columns: repeat(4, 96px); grid-auto-flow: row; gap: 14px; width: max-content;
    height: 36vh; align-content: start; overflow: hidden;
    -webkit-mask-image: linear-gradient(to bottom, #000 55%, transparent 100%); mask-image: linear-gradient(to bottom, #000 55%, transparent 100%);
  }
  .card {
    position: relative; display: block; width: 96px; height: 96px;
    --cut: 12px; clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut));
    background: var(--glass) center / cover no-repeat;
    box-shadow: inset 0 0 0 1px rgba(var(--glow), 0.12);
    transition: box-shadow 200ms, transform 300ms var(--ease);
  }
  .card:hover { box-shadow: inset 0 0 0 1px rgba(var(--glow), 0.35); transform: translateX(4px); }
  .card.busy { filter: saturate(0.6); }
  .n { position: absolute; right: 8px; top: 6px; font-size: 10px; color: var(--muted); text-shadow: 0 1px 6px rgba(3, 10, 24, 0.9); }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--gold); transform-origin: left; box-shadow: 0 0 8px rgba(243, 225, 184, 0.8); transition: transform 400ms var(--ease); }
  /* the one loader: a point of light travelling around the card */
  .ring {
    position: absolute; inset: 0; pointer-events: none; padding: 1.5px;
    background: conic-gradient(from var(--a, 0deg), transparent 0 62%, rgba(var(--glow), 0.25) 78%, rgba(var(--glow), 1) 92%, transparent 100%);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude;
    animation: orbit 2.2s linear infinite;
  }
  @property --a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
  @keyframes orbit { to { --a: 360deg; } }
</style>
