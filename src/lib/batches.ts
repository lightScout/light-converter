/**
 * Local batch store (IndexedDB, Blobs — no base64, no size ceiling). Everything stays on the
 * device: originals, results and progress. Nothing here talks to a server.
 */
import { db, urlFor } from './db';

export type ImageState = 'queued' | 'uploading' | 'processing' | 'done' | 'failed';

export interface BatchImage {
  id: string;
  name: string;
  src: Blob;          // original (downscaled to ≤ 2048 px for the local build)
  result?: Blob;      // PNG with alpha
  state: ImageState;
  progress: number;   // 0..1
}

export interface Batch {
  id: string;
  name: string;
  createdAt: number;
  images: BatchImage[];
  format: 'PNG' | 'WebP';
  size: 'Standard' | 'HD';
}

export { urlFor };

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

export async function readAll(): Promise<Batch[]> {
  try { return (await db.all<Batch>()).sort((a, b) => b.createdAt - a.createdAt); } catch { return []; }
}
export async function getBatch(id: string): Promise<Batch | undefined> {
  try { return await db.get<Batch>(id); } catch { return undefined; }
}
export async function upsert(batch: Batch) {
  try { await db.put(batch); } catch (e) { console.warn('[batches] save failed', e); }
}

/** Decode + downscale to a JPEG/PNG blob (keeps alpha for PNG sources). */
async function shrink(file: File, max = 2048): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (s === 1) { bmp.close(); return file; }
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const png = /png|webp/i.test(file.type);
  return new Promise<Blob>((res) => c.toBlob(b => res(b!), png ? 'image/png' : 'image/jpeg', 0.9));
}

export async function createBatch(files: File[], name?: string): Promise<Batch> {
  const accepted = files.filter(f => /^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name)).slice(0, 50);
  const images: BatchImage[] = [];
  for (const f of accepted) {
    try { images.push({ id: uid(), name: f.name, src: await shrink(f), state: 'queued', progress: 0 }); }
    catch (e) { console.warn('[batches] could not decode', f.name, e); }
  }
  const batch: Batch = {
    id: uid(),
    name: name ?? (accepted.length === 1 ? accepted[0].name.replace(/\.[^.]+$/, '') : `Batch ${uid().slice(0, 4)}`),
    createdAt: Date.now(),
    images,
    format: 'PNG',
    size: 'Standard',
  };
  await upsert(batch);
  return batch;
}

/** Local pipeline (free tier): in-browser model via the remover worker. */
export function runLocal(batch: Batch, onChange: (b: Batch) => void) {
  let stopped = false;
  (async () => {
    const { removeBackground, warmUp } = await import('./remover');
    for (const img of batch.images) if (img.state !== 'done') { img.state = 'uploading'; img.progress = 0.08; }
    onChange(batch);
    try { await warmUp(); } catch {
      for (const img of batch.images) if (img.state !== 'done') { img.state = 'failed'; img.progress = 0; }
      onChange(batch); await upsert(batch); return;
    }
    for (const img of batch.images) {
      if (stopped) return;
      if (img.state === 'done') continue;
      img.state = 'processing'; img.progress = 0.35; onChange(batch);
      const tick = setInterval(() => { if (img.state === 'processing') { img.progress = Math.min(0.92, img.progress + 0.04); onChange(batch); } }, 250);
      try {
        img.result = await removeBackground(img.src);
        img.state = 'done'; img.progress = 1;
      } catch (e) {
        console.error('[remover]', e);
        img.state = 'failed'; img.progress = 0;
      } finally { clearInterval(tick); }
      onChange(batch); await upsert(batch);
    }
  })();
  return () => { stopped = true; };
}
