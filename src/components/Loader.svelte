<script lang="ts">
  /* Square-row loader. progress 0..1 fills cells; one lit cell scans while indeterminate. */
  let { progress = null, label = 'Loading', cells = 13 }: { progress?: number | null; label?: string; cells?: number } = $props();
  let scan = $state(0);
  $effect(() => { const id = setInterval(() => { scan = (scan + 1) % cells; }, 90); return () => clearInterval(id); });
  const filled = $derived(progress == null ? 0 : Math.round(progress * cells));
</script>

<div class="loader label">
  <span class="pct">{progress == null ? '' : `${Math.round(progress * 100)}%`}</span>
  <span class="sqload">
    {#each Array(cells) as _, i}
      <i class:done={i < filled} class:on={i === scan}></i>
    {/each}
  </span>
  <span class="dim">{label}</span>
</div>

<style>
  .loader { display: grid; gap: 8px; justify-items: start; }
  .pct { justify-self: end; min-height: 1em; }
</style>
