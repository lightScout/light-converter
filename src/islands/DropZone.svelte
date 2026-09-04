<script lang="ts">
  import { onMount } from 'svelte';
  import { createBatch } from '../lib/batches';

  let { label = 'Drop images here', hint = 'or paste  ⌘V' }: { label?: string; hint?: string } = $props();

  let input: HTMLInputElement;
  let over = $state(false);
  let busy = $state(false);

  async function handle(files: FileList | File[] | null) {
    const list = Array.from(files ?? []);
    if (!list.length || busy) return;
    busy = true;
    try {
      const batch = await createBatch(list);
      if (batch.images.length) location.href = `/app/batch?id=${batch.id}`;
    } finally { busy = false; }
  }

  onMount(() => {
    // The whole page is the drop target.
    let depth = 0;
    const enter = (e: DragEvent) => { e.preventDefault(); depth++; over = true; };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) over = false; };
    const overH = (e: DragEvent) => { e.preventDefault(); };
    const drop = (e: DragEvent) => { e.preventDefault(); depth = 0; over = false; handle(e.dataTransfer?.files ?? null); };
    const paste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? []).filter(i => i.kind === 'file').map(i => i.getAsFile()!).filter(Boolean);
      if (files.length) handle(files);
    };
    document.addEventListener('dragenter', enter);
    document.addEventListener('dragleave', leave);
    document.addEventListener('dragover', overH);
    document.addEventListener('drop', drop);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('dragenter', enter);
      document.removeEventListener('dragleave', leave);
      document.removeEventListener('dragover', overH);
      document.removeEventListener('drop', drop);
      document.removeEventListener('paste', paste);
    };
  });
</script>

<div class="wrap" class:over>
  <button class="cta" class:is-open={over} onclick={() => input.click()} disabled={busy}>
    {busy ? 'Reading…' : over ? 'Release to start' : label}
  </button>
  {#if hint}<span class="dim hint">{hint}</span>{/if}
  <input bind:this={input} type="file" accept="image/*,.heic" multiple hidden onchange={(e) => handle((e.currentTarget as HTMLInputElement).files)} />
</div>

<style>
  .wrap { display: inline-flex; align-items: baseline; gap: 24px; margin-top: 44px; }
  .cta { font-size: 22px; transition: color 200ms; }
  .cta:disabled { color: var(--muted); cursor: default; }
  .hint { font-size: 13px; }
  .over .cta { color: var(--lavender); }
</style>
