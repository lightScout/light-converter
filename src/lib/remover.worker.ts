/**
 * Background-removal worker — the free tier.
 * IS-Net (Apache-2.0, from the DIS project via rembg's ONNX export), quantised by us:
 *   /models/isnet-fp16.onnx  (90 MB) → WebGPU
 *   /models/isnet-int8.onnx  (46 MB) → WASM fallback
 * Input 1×3×1024×1024, (x/255 − 0.5); output 1×1×1024×1024 saliency, min-max normalised.
 */
import * as ort from 'onnxruntime-web';

export type WorkerIn =
  | { type: 'init'; base: string }
  | { type: 'run'; id: string; data: Float32Array };
export type WorkerOut =
  | { type: 'ready'; backend: 'webgpu' | 'wasm' }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'mask'; id: string; mask: Float32Array }
  | { type: 'error'; id?: string; message: string };

const SIZE = 1024;
let session: ort.InferenceSession | null = null;
let backend: 'webgpu' | 'wasm' = 'wasm';

const post = (m: WorkerOut, transfer?: Transferable[]) => (self as any).postMessage(m, transfer ?? []);

async function fetchModel(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model ${res.status}`);
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

async function init(base: string) {
  ort.env.wasm.wasmPaths = `${base}/ort/`;
  ort.env.wasm.numThreads = (self as any).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

  const hasGpu = typeof (navigator as any).gpu !== 'undefined';
  if (hasGpu) {
    try {
      const buf = await fetchModel(`${base}/models/isnet-fp16.onnx`);
      session = await ort.InferenceSession.create(buf, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
      backend = 'webgpu';
      post({ type: 'ready', backend });
      return;
    } catch (e) { console.warn('[remover] webgpu failed, falling back to wasm', e); }
  }
  const buf = await fetchModel(`${base}/models/isnet-int8.onnx`);
  session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  backend = 'wasm';
  post({ type: 'ready', backend });
}

async function run(id: string, data: Float32Array) {
  if (!session) throw new Error('not ready');
  const input = new ort.Tensor('float32', data, [1, 3, SIZE, SIZE]);
  const out = await session.run({ input_image: input });
  const m = out.output_image.data as Float32Array;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < m.length; i++) { if (m[i] < lo) lo = m[i]; if (m[i] > hi) hi = m[i]; }
  const range = hi - lo || 1;
  const mask = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) mask[i] = (m[i] - lo) / range;
  post({ type: 'mask', id, mask }, [mask.buffer]);
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') await init(msg.base);
    else if (msg.type === 'run') await run(msg.id, msg.data);
  } catch (err: any) {
    post({ type: 'error', id: (msg as any).id, message: err?.message || String(err) });
  }
};
