/**
 * Main-thread side of the free-tier remover: pre/post-processing on canvases,
 * inference in the worker. One shared worker/session per page.
 */
import type { WorkerIn, WorkerOut } from './remover.worker';

const SIZE = 1024;

type Pending = { resolve: (m: Float32Array) => void; reject: (e: Error) => void };

export interface RemoverStatus {
  state: 'idle' | 'loading' | 'ready' | 'error';
  backend?: 'webgpu' | 'wasm';
  loaded?: number; total?: number;
  message?: string;
}

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let seq = 0;
const pending = new Map<string, Pending>();
const listeners = new Set<(s: RemoverStatus) => void>();
let status: RemoverStatus = { state: 'idle' };

const setStatus = (s: RemoverStatus) => { status = s; listeners.forEach(l => l(s)); };
export const onStatus = (l: (s: RemoverStatus) => void) => { listeners.add(l); l(status); return () => { listeners.delete(l); }; };
export const getStatus = () => status;

export function warmUp(): Promise<void> {
  if (ready) return ready;
  setStatus({ state: 'loading', loaded: 0, total: 0 });
  worker = new Worker(new URL('./remover.worker.ts', import.meta.url), { type: 'module' });
  ready = new Promise<void>((resolve, reject) => {
    worker!.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'progress') setStatus({ state: 'loading', loaded: m.loaded, total: m.total });
      else if (m.type === 'ready') { setStatus({ state: 'ready', backend: m.backend }); resolve(); }
      else if (m.type === 'mask') { pending.get(m.id)?.resolve(m.mask); pending.delete(m.id); }
      else if (m.type === 'error') {
        if (m.id) { pending.get(m.id)?.reject(new Error(m.message)); pending.delete(m.id); }
        else { setStatus({ state: 'error', message: m.message }); reject(new Error(m.message)); }
      }
    };
    worker!.onerror = (e) => { setStatus({ state: 'error', message: e.message }); reject(new Error(e.message)); };
    const msg: WorkerIn = { type: 'init', base: location.origin };
    worker!.postMessage(msg);
  });
  return ready;
}

async function decode(src: string): Promise<ImageBitmap> {
  const blob = await (await fetch(src)).blob();
  return createImageBitmap(blob);
}

/** Returns a PNG data URL with alpha. */
export async function removeBackground(src: string): Promise<string> {
  await warmUp();
  const bmp = await decode(src);
  const { width: W, height: H } = bmp;

  // pre: letterbox-free resize to 1024², (x/255 - 0.5), CHW
  const c = new OffscreenCanvas(SIZE, SIZE);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const n = SIZE * SIZE;
  const data = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    data[i] = px[i * 4] / 255 - 0.5;
    data[n + i] = px[i * 4 + 1] / 255 - 0.5;
    data[2 * n + i] = px[i * 4 + 2] / 255 - 0.5;
  }

  const id = String(++seq);
  const mask = await new Promise<Float32Array>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const msg: WorkerIn = { type: 'run', id, data };
    worker!.postMessage(msg, [data.buffer]);
  });

  // post: mask → alpha at 1024², upscale to W×H with bilinear via canvas, apply to original
  const mc = new OffscreenCanvas(SIZE, SIZE);
  const mctx = mc.getContext('2d')!;
  const mimg = mctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < n; i++) { const a = Math.round(mask[i] * 255); mimg.data[i * 4] = 255; mimg.data[i * 4 + 1] = 255; mimg.data[i * 4 + 2] = 255; mimg.data[i * 4 + 3] = a; }
  mctx.putImageData(mimg, 0, 0);

  const out = new OffscreenCanvas(W, H);
  const octx = out.getContext('2d')!;
  octx.drawImage(bmp, 0, 0);
  octx.globalCompositeOperation = 'destination-in';
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(mc, 0, 0, W, H);
  bmp.close();

  const blob = await out.convertToBlob({ type: 'image/png' });
  return new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
}
