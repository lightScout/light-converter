/**
 * Local-only batch store. Files are kept as data URLs in sessionStorage so a drop on
 * one page can be picked up by the batch page after navigation. This is the mock
 * pipeline; the real one uploads to R2 and streams progress over SSE (see the plan).
 */
export type ImageState = 'queued' | 'uploading' | 'processing' | 'done' | 'failed';

export interface BatchImage {
  id: string;
  name: string;
  src: string;        // data URL of the original (local mock)
  result?: string;    // data URL of the cutout (mock: same image)
  state: ImageState;
  progress: number;   // 0..1
  cost: number;       // Light
}

export interface Batch {
  id: string;
  name: string;
  createdAt: number;
  images: BatchImage[];
  format: 'PNG' | 'WebP';
  size: 'Standard' | 'HD';
}

const KEY = 'lc:batches';

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

export function readAll(): Batch[] {
  try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; }
}
export function writeAll(batches: Batch[]) {
  try { sessionStorage.setItem(KEY, JSON.stringify(batches)); } catch { /* quota: ignore for the mock */ }
}
export function getBatch(id: string) { return readAll().find(b => b.id === id); }
export function upsert(batch: Batch) {
  const all = readAll().filter(b => b.id !== batch.id);
  writeAll([batch, ...all].slice(0, 12));
}

const readAsDataURL = (file: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = rej;
  r.readAsDataURL(file);
});

/** Downscale big files so the mock store stays small. */
async function shrink(file: File, max = 1200): Promise<string> {
  const url = await readAsDataURL(file);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const s = Math.min(1, max / Math.max(img.width, img.height));
  if (s === 1 && file.size < 400_000) return url;
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

export async function createBatch(files: File[], name?: string): Promise<Batch> {
  const accepted = files.filter(f => /^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name)).slice(0, 50);
  const images: BatchImage[] = [];
  for (const f of accepted) {
    images.push({ id: uid(), name: f.name, src: await shrink(f), state: 'queued', progress: 0, cost: 1 });
  }
  const batch: Batch = {
    id: uid(),
    name: name ?? (accepted.length === 1 ? accepted[0].name.replace(/\.[^.]+$/, '') : `Batch ${uid().slice(0, 4)}`),
    createdAt: Date.now(),
    images,
    format: 'PNG',
    size: 'Standard',
  };
  upsert(batch);
  return batch;
}

/** Mock pipeline: staggered upload → process → done. Calls onChange on every tick. */
export function runMock(batch: Batch, onChange: (b: Batch) => void, concurrency = 3) {
  let active = 0, next = 0, stopped = false;
  const tick = () => {
    if (stopped) return;
    while (active < concurrency && next < batch.images.length) {
      const img = batch.images[next++];
      active++;
      img.state = 'uploading'; img.progress = 0;
      const t0 = performance.now();
      const dur = 1400 + Math.random() * 1800;
      const step = () => {
        if (stopped) return;
        const t = (performance.now() - t0) / dur;
        img.progress = Math.min(1, t);
        img.state = t < 0.35 ? 'uploading' : t < 1 ? 'processing' : 'done';
        if (img.state === 'done') { img.result = img.src; active--; onChange(batch); upsert(batch); tick(); return; }
        onChange(batch);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    onChange(batch);
  };
  tick();
  return () => { stopped = true; };
}
