/**
 * Main-thread side of the free-tier remover: pre/post-processing on canvases,
 * inference in the worker. One shared worker/session per page.
 */
import type { WorkerIn, WorkerOut } from './remover.worker';

const SIZE = 1024;

type Result = { rgba: Uint8ClampedArray; width: number; height: number };
type Pending = { resolve: (m: Result) => void; reject: (e: Error) => void };

export interface RemoverStatus {
  state: 'idle' | 'loading' | 'ready' | 'error';
  backend?: 'webgpu' | 'wasm';
  model?: string;
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

const RUN_TIMEOUT_MS = 120_000;
let forced: 'webgpu' | 'wasm' | undefined =
  typeof location !== 'undefined' && /[?&]backend=(wasm|webgpu)/.test(location.search)
    ? (location.search.match(/[?&]backend=(wasm|webgpu)/)![1] as 'wasm' | 'webgpu')
    : undefined;

function failAll(err: Error) {
  for (const [, p] of pending) p.reject(err);
  pending.clear();
}

/** Tear down and restart on the WASM backend (used when WebGPU stalls). */
export function restartOnWasm(): Promise<void> {
  worker?.terminate();
  worker = null; ready = null; forced = 'wasm';
  failAll(new Error('restarting on wasm'));
  return warmUp();
}

export function warmUp(): Promise<void> {
  if (ready) return ready;
  setStatus({ state: 'loading', loaded: 0, total: 0 });
  worker = new Worker(new URL('./remover.worker.ts', import.meta.url), { type: 'module' });
  ready = new Promise<void>((resolve, reject) => {
    worker!.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'progress') setStatus({ state: 'loading', loaded: m.loaded, total: m.total });
      else if (m.type === 'ready') { setStatus({ state: 'ready', backend: m.backend, model: m.model }); resolve(); }
      else if (m.type === 'result') { pending.get(m.id)?.resolve({ rgba: m.rgba, width: m.width, height: m.height }); pending.delete(m.id); }
      else if (m.type === 'error') {
        if (m.id) { pending.get(m.id)?.reject(new Error(m.message)); pending.delete(m.id); }
        else { setStatus({ state: 'error', message: m.message }); reject(new Error(m.message)); }
      }
    };
    worker!.onerror = (e) => { console.error('[remover] worker error', e); setStatus({ state: 'error', message: e.message || 'worker crashed' }); failAll(new Error(e.message || 'worker crashed')); reject(new Error(e.message || 'worker crashed')); };
    const msg: WorkerIn = { type: 'init', base: location.origin, force: forced };
    worker!.postMessage(msg);
  });
  return ready;
}

async function decode(src: Blob): Promise<ImageBitmap> {
  return createImageBitmap(src);
}

async function inferOnce(rgba: Uint8ClampedArray, full: Uint8ClampedArray, width: number, height: number): Promise<Result> {
  const id = String(++seq);
  return new Promise<Result>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`inference timed out after ${RUN_TIMEOUT_MS / 1000}s on ${status.backend}`)); }, RUN_TIMEOUT_MS);
    pending.set(id, {
      resolve: (m) => { clearTimeout(timer); resolve(m); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    const msg: WorkerIn = { type: 'run', id, rgba, full, width, height };
    worker!.postMessage(msg, [rgba.buffer, full.buffer]);
  });
}

/** Infer; if WebGPU stalls or throws, restart on WASM once and retry. */
async function infer(rgba: Uint8ClampedArray, full: Uint8ClampedArray, width: number, height: number): Promise<Result> {
  const copy = rgba.slice(), fullCopy = full.slice(); // buffers are transferred to the worker
  try {
    return await inferOnce(rgba, full, width, height);
  } catch (e) {
    if (status.backend === 'webgpu') {
      console.warn('[remover] webgpu run failed, retrying on wasm:', e);
      await restartOnWasm();
      return inferOnce(copy, fullCopy, width, height);
    }
    throw e;
  }
}

/** Returns a PNG blob with alpha. */
export async function removeBackground(src: Blob): Promise<Blob> {
  await warmUp();
  const bmp = await decode(src);
  const { width: W, height: H } = bmp;

  // pre: resize to 1024² (normalisation happens in the worker, per model)
  const c = new OffscreenCanvas(SIZE, SIZE);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;

  // full-res pixels for edge refinement
  const fc = new OffscreenCanvas(W, H);
  const fctx = fc.getContext('2d', { willReadFrequently: true })!;
  fctx.drawImage(bmp, 0, 0);
  const full = fctx.getImageData(0, 0, W, H).data;
  bmp.close();

  const res = await infer(px, full, W, H);

  const out = new OffscreenCanvas(W, H);
  const octx = out.getContext('2d')!;
  octx.putImageData(new ImageData(res.rgba, res.width, res.height), 0, 0);

  return out.convertToBlob({ type: 'image/png' });
}
