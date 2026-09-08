/**
 * Background-removal worker — runs entirely on the device.
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
export type { RunParams as RemoverParams };

export type Backend = 'webgpu' | 'wasm';
/** Knobs the edit view exposes. All optional; defaults reproduce the batch run. */
export interface RunParams {
  sensitivity?: number;   // −1 … 1  shifts what counts as subject (+ keeps more, − cuts more)
  secondLook?: 'auto' | 'on' | 'off';
  boost?: number;         // CLAHE clip limit for the second look, 1 … 4
  cleanup?: 'off' | 'normal' | 'strong';
  fillHoles?: boolean;
  edge?: number;          // 0 … 1  how much the guided filter is allowed to move edge alpha
}
export type WorkerIn =
  | { type: 'init'; base: string; force?: Backend }
  | { type: 'run'; id: string; rgba: Uint8ClampedArray; full: Uint8ClampedArray; width: number; height: number; params?: RunParams };
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
  // Model bytes live in Cache Storage after the first download, whatever the server's cache headers say.
  const cache = 'caches' in self ? await caches.open('lc-models-v1').catch(() => null) : null;
  const hit = cache ? await cache.match(url).catch(() => undefined) : undefined;
  if (hit) { const buf = await hit.arrayBuffer(); post({ type: 'progress', loaded: buf.byteLength, total: buf.byteLength }); return buf; }
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
  if (cache) cache.put(url, new Response(out.slice().buffer, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
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
function cleanComponents(mask: Float32Array, thresh = 0.5, strength: 'normal' | 'strong' = 'normal') {
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
  const keepMin = strength === 'strong' ? Math.max(N * 0.01, largest * 0.15) : Math.max(N * 0.002, largest * 0.03);
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


/** CLAHE on luma at model resolution: lifts low-contrast subjects (white shirt on a white wall) so the model can see them. */
function boostContrast(rgba: Uint8ClampedArray, tiles = 8, clip = 2.5): Uint8ClampedArray {
  const T = SIZE / tiles, out = new Uint8ClampedArray(rgba.length);
  const lum = new Uint8Array(N);
  for (let i = 0; i < N; i++) lum[i] = (rgba[i*4] * 0.299 + rgba[i*4+1] * 0.587 + rgba[i*4+2] * 0.114) | 0;
  const luts = new Float32Array(tiles * tiles * 256);
  const limit = clip * (T * T) / 256;
  const h = new Float32Array(256);
  for (let ty = 0; ty < tiles; ty++) for (let tx = 0; tx < tiles; tx++) {
    h.fill(0);
    for (let y = ty * T; y < (ty + 1) * T; y++) for (let x = tx * T; x < (tx + 1) * T; x++) h[lum[y * SIZE + x]]++;
    let excess = 0; for (let b = 0; b < 256; b++) if (h[b] > limit) { excess += h[b] - limit; h[b] = limit; }
    const add = excess / 256; let c = 0; const base = (ty * tiles + tx) * 256;
    for (let b = 0; b < 256; b++) { c += h[b] + add; luts[base + b] = c; }
    const c0 = luts[base], c1 = luts[base + 255] - c0 || 1;
    for (let b = 0; b < 256; b++) luts[base + b] = (luts[base + b] - c0) / c1;
  }
  for (let y = 0; y < SIZE; y++) {
    const fy = (y + 0.5) / T - 0.5, y0 = Math.min(tiles - 1, Math.max(0, Math.floor(fy))), y1 = Math.min(tiles - 1, y0 + 1), wy = Math.min(1, Math.max(0, fy - y0));
    for (let x = 0; x < SIZE; x++) {
      const fx = (x + 0.5) / T - 0.5, x0 = Math.min(tiles - 1, Math.max(0, Math.floor(fx))), x1 = Math.min(tiles - 1, x0 + 1), wx = Math.min(1, Math.max(0, fx - x0));
      const i = y * SIZE + x, l = lum[i];
      const v = luts[(y0 * tiles + x0) * 256 + l] * (1 - wy) * (1 - wx) + luts[(y0 * tiles + x1) * 256 + l] * (1 - wy) * wx
              + luts[(y1 * tiles + x0) * 256 + l] * wy * (1 - wx) + luts[(y1 * tiles + x1) * 256 + l] * wy * wx;
      const ratio = (v * 255) / Math.max(l, 1);
      out[i*4] = Math.min(255, rgba[i*4] * ratio); out[i*4+1] = Math.min(255, rgba[i*4+1] * ratio); out[i*4+2] = Math.min(255, rgba[i*4+2] * ratio); out[i*4+3] = 255;
    }
  }
  return out;
}

/** Label 4-connected components of (pred(i) true); returns labels (0 = none) and sizes. */
function components(pred: (i: number) => boolean) {
  const label = new Int32Array(N); const sizes: number[] = [0]; const stack = new Int32Array(N); let next = 1;
  for (let start = 0; start < N; start++) {
    if (label[start] || !pred(start)) continue;
    let sp = 0, size = 0; stack[sp++] = start; label[start] = next;
    while (sp) {
      const p = stack[--sp]; size++; const x = p % SIZE, y = (p / SIZE) | 0;
      if (x > 0 && !label[p - 1] && pred(p - 1)) { label[p - 1] = next; stack[sp++] = p - 1; }
      if (x < SIZE - 1 && !label[p + 1] && pred(p + 1)) { label[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && !label[p - SIZE] && pred(p - SIZE)) { label[p - SIZE] = next; stack[sp++] = p - SIZE; }
      if (y < SIZE - 1 && !label[p + SIZE] && pred(p + SIZE)) { label[p + SIZE] = next; stack[sp++] = p + SIZE; }
    }
    sizes.push(size); next++;
  }
  return { label, sizes };
}

/** How much of the mask is undecided — a mottled region (a white shirt the model half-sees) scores high. */
function uncertainty(mask: Float32Array) { let n = 0; for (let i = 0; i < N; i++) if (mask[i] > 0.15 && mask[i] < 0.85) n++; return n / N; }

/** Second opinion: regions the contrast-boosted pass is sure about, and that touch the plain pass's main body, are added. */
function fuse(plain: Float32Array, boosted: Float32Array): Float32Array {
  const a = components(i => plain[i] > 0.5);
  let main = 0; for (let k = 1; k < a.sizes.length; k++) if (a.sizes[k] > a.sizes[main]) main = k;
  if (!main) return plain;
  const b = components(i => boosted[i] > 0.45 || a.label[i] === main);
  const keep = new Uint8Array(b.sizes.length);
  for (let i = 0; i < N; i++) if (a.label[i] === main && b.label[i]) keep[b.label[i]] = 1;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = Math.max(plain[i], b.label[i] && keep[b.label[i]] ? Math.min(1, boosted[i] * 1.5) : 0);
  return out;
}

/** Where the plain pass was undecided, the fused mask is speckled: smooth it there (box blur, re-thresholded), leaving confident edges alone. */
function settle(mask: Float32Array, plain: Float32Array, r = 5) {
  const blur = new Float32Array(N), tmp = new Float32Array(N);
  for (let y = 0; y < SIZE; y++) { let sum = 0; const row = y * SIZE; for (let x = 0; x <= r; x++) sum += mask[row + x];
    for (let x = 0; x < SIZE; x++) { const lo = x - r - 1, hi = x + r; if (hi < SIZE) sum += mask[row + hi]; if (lo >= 0) sum -= mask[row + lo]; tmp[row + x] = sum / (Math.min(hi, SIZE - 1) - Math.max(lo + 1, 0) + 1); } }
  for (let x = 0; x < SIZE; x++) { let sum = 0; for (let y = 0; y <= r; y++) sum += tmp[y * SIZE + x];
    for (let y = 0; y < SIZE; y++) { const lo = y - r - 1, hi = y + r; if (hi < SIZE) sum += tmp[hi * SIZE + x]; if (lo >= 0) sum -= tmp[lo * SIZE + x]; blur[y * SIZE + x] = sum / (Math.min(hi, SIZE - 1) - Math.max(lo + 1, 0) + 1); } }
  for (let i = 0; i < N; i++) {
    if (plain[i] > 0.85 || (plain[i] < 0.15 && mask[i] === plain[i])) continue;   // confident, untouched pixels keep their edges
    const v = Math.min(1, Math.max(0, (blur[i] - 0.15) / 0.2));
    mask[i] = v * v * (3 - 2 * v);
  }
}

/** Fill enclosed holes (background pockets not touching the border) smaller than 2 % of the frame; smooth speckle inside. */
function fillHoles(mask: Float32Array) {
  const bg = components(i => mask[i] < 0.5);
  const touches = new Uint8Array(bg.sizes.length);
  for (let x = 0; x < SIZE; x++) { touches[bg.label[x]] = 1; touches[bg.label[(SIZE - 1) * SIZE + x]] = 1; }
  for (let y = 0; y < SIZE; y++) { touches[bg.label[y * SIZE]] = 1; touches[bg.label[y * SIZE + SIZE - 1]] = 1; }
  for (let i = 0; i < N; i++) { const l = bg.label[i]; if (l && !touches[l] && bg.sizes[l] < N * 0.06) mask[i] = 1; }
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

function applySensitivity(mask: Float32Array, s: number) {
  if (!s) return;
  // shift the decision point: s>0 lowers it (keeps more), s<0 raises it; soft, so edges stay soft
  const t = 0.5 - s * 0.35, g = 1 / (1 - Math.abs(s) * 0.5);
  for (let i = 0; i < N; i++) { const v = (mask[i] - t) * g * 2; mask[i] = Math.min(1, Math.max(0, 0.5 + v / 2)); }
}

async function infer(rgba: Uint8ClampedArray, sensitivity = 0): Promise<Float32Array> {
  const input = new ort.Tensor('float32', preprocess(rgba, spec), [1, 3, SIZE, SIZE]);
  const out = await session!.run({ input_image: input });
  const mask = postprocess(out.output_image.data as Float32Array, spec);
  applySensitivity(mask, sensitivity);
  return mask;
}

async function run(id: string, rgba: Uint8ClampedArray, full: Uint8ClampedArray, width: number, height: number, params: RunParams = {}) {
  if (!session) throw new Error('not ready');
  const t = performance.now();
  const sens = params.sensitivity ?? 0;
  let mask = await infer(rgba, sens);
  // Low-contrast subjects (a white shirt on a white wall) come back mottled. When that happens, take a second look
  // at a contrast-boosted copy and let it fill in what touches the subject.
  const u = uncertainty(mask);
  let passes = 1;
  const second = params.secondLook ?? 'auto';
  if (second === 'on' || (second === 'auto' && u > 0.025)) {
    const plain = mask; const boosted = await infer(boostContrast(rgba, 8, params.boost ?? 2.5), sens); mask = fuse(plain, boosted); settle(mask, plain); passes = 2;
  }
  const cleanup = params.cleanup ?? 'normal';
  if (cleanup !== 'off') cleanComponents(mask, 0.5, cleanup);
  if (params.fillHoles ?? true) fillHoles(mask);
  const t2 = performance.now();
  const result = refineAlpha(full, width, height, mask, SIZE, params.edge ?? 1);
  console.info('[remover] run', spec.name, backend, passes + ' pass' + (passes > 1 ? 'es' : ''), 'uncertainty', u.toFixed(3), Math.round(t2 - t), 'ms + refine', Math.round(performance.now() - t2), 'ms', params);
  post({ type: 'result', id, rgba: result, width, height }, [result.buffer]);
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') await init(msg.base, msg.force);
    else if (msg.type === 'run') await run(msg.id, msg.rgba, msg.full, msg.width, msg.height, msg.params);
  } catch (err: any) {
    post({ type: 'error', id: (msg as any).id, message: err?.message || String(err) });
  }
};
