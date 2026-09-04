import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

// Local build for now. When we go to Cloudflare:
//   import cloudflare from '@astrojs/cloudflare';
//   output: 'server', adapter: cloudflare()
export default defineConfig({
  integrations: [svelte()],
  vite: {
    optimizeDeps: { include: ['three'], exclude: ['onnxruntime-web'] },
    // Cross-origin isolation lets the WASM backend use threads. Mirror these in Cloudflare's _headers later.
    server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
    preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  },
});
