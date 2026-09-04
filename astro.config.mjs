import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

// Local build for now. When we go to Cloudflare:
//   import cloudflare from '@astrojs/cloudflare';
//   output: 'server', adapter: cloudflare()
export default defineConfig({
  integrations: [svelte()],
  vite: {
    optimizeDeps: { include: ['three'] },
  },
});
