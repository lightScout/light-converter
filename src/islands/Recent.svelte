<script lang="ts">
  import { onMount } from 'svelte';
  import { readAll, urlFor, type Batch } from '../lib/batches';

  let { mode = 'thumbs' }: { mode?: 'thumbs' | 'rows' } = $props();
  let batches = $state<Batch[]>([]);
  onMount(async () => { batches = (await readAll()).slice(0, mode === 'rows' ? 40 : 3); });

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
  <section class="recent">
    <span class="dim eyebrow">Recent</span>
    <ul>
      {#each batches as b (b.id)}
        <li>
          <a href={`/app/batch?id=${b.id}`}>
            <span class="thumb" style={`background-image:url(${urlFor(b.images[0]?.result ?? b.images[0]?.src)})`}></span>
            <span class="meta">
              <span class="name">{b.name}</span>
              <span class="sub" class:gold={summary(b).startsWith('processing')} class:dim={!summary(b).startsWith('processing')}>{summary(b)}</span>
            </span>
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
  .recent { margin-top: 22vh; }
  .eyebrow { font-size: 12px; letter-spacing: 0.08em; }
  ul { list-style: none; margin: 14px 0 0; padding: 0; display: flex; gap: 40px; flex-wrap: wrap; }
  a { display: flex; align-items: center; gap: 14px; }
  .thumb {
    width: 64px; height: 64px; border-radius: 10px; flex: none;
    background: var(--glass) center / cover no-repeat;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  }
  .meta { display: grid; line-height: 1.35; }
  .name { font-size: 14px; font-weight: 500; }
  .sub { font-size: 12px; }
</style>
