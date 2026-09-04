# Light Converter — local build

Astro 7 + Svelte 5 islands + Three.js (quasar title). No backend yet: batches live in `sessionStorage` and the
pipeline is mocked (`src/lib/batches.ts` → `runMock`). Swap the mock for the R2 + Queue + SSE flow from the plan.

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
```

Routes: `/` landing · `/pricing` · `/app` home · `/app/batch?id=…` · `/app/batches` · `/app/light` · `/app/settings`.

Design source: Penpot "LC - Light Converter Website", boards prefixed `v0.4`. Tokens in `src/styles/global.css`.
# light-converter
