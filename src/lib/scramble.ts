/** Text decode: characters resolve left-to-right out of a scramble. Mono labels only. */
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789·';
export function scramble(el: HTMLElement, text = el.dataset.text ?? el.textContent ?? '', ms = 700) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = text; return; }
  el.dataset.text = text;
  const start = performance.now();
  const seed = Array.from(text, () => Math.random());
  const tick = (now: number) => {
    const p = Math.min(1, (now - start) / ms);
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === ' ' || p >= (i + 1) / text.length + seed[i] * 0.15 - 0.15) out += c;
      else out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    el.textContent = out;
    if (p < 1) requestAnimationFrame(tick); else el.textContent = text;
  };
  requestAnimationFrame(tick);
}
/** Scramble every [data-scramble] inside root, staggered. */
export function scrambleAll(root: ParentNode = document, stagger = 40) {
  root.querySelectorAll<HTMLElement>('[data-scramble]').forEach((el, i) => setTimeout(() => scramble(el), i * stagger));
}
