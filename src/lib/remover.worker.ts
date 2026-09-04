/**
 * Background-removal worker — the free tier.
 *
 *  WebGPU : BiRefNet (MIT, swin_v1_tiny backbone, ZhengPeng7/BiRefNet release v1), fp16 — /models/birefnet-tiny-fp16.onnx (114 MB)
 *  WASM   : IS-Net (Apache-2.0, DIS via rembg's export), int8                          — /models/isnet-int8.onnx (46 MB)
 *
 * BiRefNet needs ~6 GB of activations at 1024², which is over WASM's 4 GB limit, so it is WebGPU-only.
 * Both take 1×3×1024×1024 and return 1×1×1024×1024. Pre/post differ per model and live here so the
 * main thread only ships raw RGBA pixels and gets back a 0..1 alpha mask.
 */
import * as ort from 'onnxruntime-web';
import { refineAlpha } from './refine';

export type Backend = 'webgpu' | 'wasm';
export type WorkerIn =
  | { type: 'init'; base: string; force?: Backend }
  | { type: 'run'; id: string; rgba: Uint8ClampedArray; full: Uint8ClampedArray; width: number; height: number };
export type WorkerOut =
  | { type: 'ready'; backend: Backend; model: string }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'result'; id: string; rgba: Uint8ClampedArray; width: number; height: number }
  | { type: 'error'; id?: string; message: string };

const SIZE = 1024;
const N = SIZE * SIZE;

type ModelSpec = {
  name: string;
  file: string;
  mean: [number, number, number];
  std: [number, number, number];
  post: 'sigmoid' | 'minmax';
};
const BIREFNET: ModelSpec = { name: 'birefnet-tiny', file: 'birefnet-tiny-fp16.onnx', mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], post: 'sigmoid' };
const ISNET: ModelSpec = { name: 'isnet', file: 'isnet-int8.onnx', mean: [0.5, 0.5, 0.5], std: [1, 1, 1], post: 'minmax' };

let session: ort.InferenceSession | null = null;
let spec: ModelSpec = ISNET;
let backend: Backend = 'wasm';

const post = (m: WorkerOut, transfer?: Transferable[]) => (self as any).postMessage(m, transfer ?? []);

async function fetchModel(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model ${res.status} ${url}`);
  const total = Number(res.headers.get('content-length') || 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); loaded += value.length;
    post({ type: 'progress', loaded, total });
  }
  const out = new Uint8Array(loaded);
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

function preprocess(rgba: Uint8ClampedArray, s: ModelSpec): Float32Array {
  const data = new Float32Array(3 * N);
  const [mr, mg, mb] = s.mean, [sr, sg, sb] = s.std;
  for (let i = 0; i < N; i++) {
    data[i] = (rgba[i * 4] / 255 - mr) / sr;
    data[N + i] = (rgba[i * 4 + 1] / 255 - mg) / sg;
    data[2 * N + i] = (rgba[i * 4 + 2] / 255 - mb) / sb;
  }
  return data;
}

/** Keep only connected foreground components that are big enough; kills wall speckle and stray blobs. */
function cleanComponents(mask: Float32Array, thresh = 0.5) {
  const label = new Int32Array(N); // 0 = unvisited/background
  const sizes: number[] = [0];
  const stack = new Int32Array(N);
  let next = 1;
  for (let start = 0; start < N; start++) {
    if (label[start] || mask[start] < thresh) continue;
    let sp = 0, size = 0;
    stack[sp++] = start; label[start] = next;
    while (sp) {
      const p = stack[--sp]; size++;
      const x = p % SIZE, y = (p / SIZE) | 0;
      if (x > 0 && !label[p - 1] && mask[p - 1] >= thresh) { label[p - 1] = next; stack[sp++] = p - 1; }
      if (x < SIZE - 1 && !label[p + 1] && mask[p + 1] >= thresh) { label[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && !label[p - SIZE] && mask[p - SIZE] >= thresh) { label[p - SIZE] = next; stack[sp++] = p - SIZE; }
      if (y < SIZE - 1 && !label[p + SIZE] && mask[p + SIZE] >= thresh) { label[p + SIZE] = next; stack[sp++] = p + SIZE; }
    }
    sizes.push(size); next++;
  }
  if (next <= 2) return; // one component, nothing to clean
  let largest = 0; for (const s of sizes) if (s > largest) largest = s;
  const keepMin = Math.max(N * 0.002, largest * 0.03);
  const keep = sizes.map(s => s >= keepMin);
  const kept = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (label[i] && keep[label[i]]) kept[i] = 1;
  // Soft edge pixels (below threshold) survive only within 2 px of a kept component.
  for (let i = 0; i < N; i++) {
    if (mask[i] <= 0 || kept[i]) continue;
    const x = i % SIZE, y = (i / SIZE) | 0;
    let near = 0;
    for (let dy = -2; dy <= 2 && !near; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= SIZE) continue;
      for (let dx = -2; dx <= 2; dx++) { const xx = x + dx; if (xx < 0 || xx >= SIZE) continue; if (kept[yy * SIZE + xx]) { near = 1; break; } }
    }
    if (!near) mask[i] = 0;
  }
}

function postprocess(raw: Float32Array, s: ModelSpec): Float32Array {
  const mask = new Float32Array(N);
  if (s.post === 'sigmoid') {
    for (let i = 0; i < N; i++) mask[i] = 1 / (1 + Math.exp(-raw[i]));
  } else {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < N; i++) { if (raw[i] < lo) lo = raw[i]; if (raw[i] > hi) hi = raw[i]; }
    const range = hi - lo || 1;
    // IS-Net's saliency is soft everywhere; pull the curve so background noise drops out and the subject saturates.
    for (let i = 0; i < N; i++) { const v = (raw[i] - lo) / range; mask[i] = Math.min(1, Math.max(0, (v - 0.15) / 0.7)); }
  }
  cleanComponents(mask);
  return mask;
}

async function createSession(buf: ArrayBuffer, ep: Backend) {
  return ort.InferenceSession.create(buf, {
    executionProviders: [ep],
    graphOptimizationLevel: 'all',
    enableMemPattern: false,
    enableCpuMemArena: ep === 'wasm',
  });
}

async function init(base: string, force?: Backend) {
  ort.env.wasm.wasmPaths = `${base}/ort/`;
  ort.env.wasm.numThreads = (self as any).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  ort.env.logLevel = 'warning';
  console.info('[remover] init', { force, crossOriginIsolated: (self as any).crossOriginIsolated, threads: ort.env.wasm.numThreads, gpu: typeof (navigator as any).gpu });

  const wantGpu = force !== 'wasm' && typeof (navigator as any).gpu !== 'undefined';
  if (wantGpu) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (!adapter) throw new Error('no WebGPU adapter');
      const buf = await fetchModel(`${base}/models/${BIREFNET.file}`);
      const t0 = performance.now();
      session = await createSession(buf, 'webgpu');
      console.info('[remover] birefnet session', Math.round(performance.now() - t0), 'ms');
      const t = performance.now();
      await session.run({ input_image: new ort.Tensor('float32', new Float32Array(3 * N), [1, 3, SIZE, SIZE]) });
      console.info('[remover] webgpu warm-up', Math.round(performance.now() - t), 'ms');
      spec = BIREFNET; backend = 'webgpu';
      post({ type: 'ready', backend, model: spec.name });
      return;
    } catch (e) {
      console.warn('[remover] webgpu/birefnet unavailable, using wasm/isnet:', e);
      try { await session?.release(); } catch {}
      session = null;
    }
  }
  const buf = await fetchModel(`${base}/models/${ISNET.file}`);
  session = await createSession(buf, 'wasm');
  spec = ISNET; backend = 'wasm';
  post({ type: 'ready', backend, model: spec.name });
}

async function run(id: string, rgba: Uint8ClampedArray, full: Uint8ClampedArray, width: number, height: number) {
  if (!session) throw new Error('not ready');
  const input = new ort.Tensor('float32', preprocess(rgba, spec), [1, 3, SIZE, SIZE]);
  const t = performance.now();
  const out = await session.run({ input_image: input });
  const raw = out.output_image.data as Float32Array;
  const mask = postprocess(raw, spec);
  const t2 = performance.now();
  const result = refineAlpha(full, width, height, mask, SIZE);
  console.info('[remover] run', spec.name, backend, Math.round(t2 - t), 'ms + refine', Math.round(performance.now() - t2), 'ms');
  post({ type: 'result', id, rgba: result, width, height }, [result.buffer]);
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') await init(msg.base, msg.force);
    else if (msg.type === 'run') await run(msg.id, msg.rgba, msg.full, msg.width, msg.height);
  } catch (err: any) {
    post({ type: 'error', id: (msg as any).id, message: err?.message || String(err) });
  }
};
