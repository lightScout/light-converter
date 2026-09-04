// Copies the onnxruntime-web WASM runtime into public/ort so the worker can load it same-origin.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
const src = new URL('../node_modules/onnxruntime-web/dist/', import.meta.url);
const dst = new URL('../public/ort/', import.meta.url);
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) if (/^ort-wasm-simd-threaded(\.jsep)?\.(wasm|mjs)$/.test(f)) cpSync(new URL(f, src), new URL(f, dst));
console.log('ort runtime copied to public/ort');
