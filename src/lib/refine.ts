/**
 * Full-resolution alpha refinement (runs in the worker).
 *
 * 1. Bilinear-upsample the 1024² model mask to the image size.
 * 2. Guided filter (He et al.) with the image luminance as guide — puts hair strands and crisp edges
 *    back that a 1024² mask cannot hold.
 * 3. Colour decontamination — semi-transparent edge pixels are a mix of subject and background;
 *    estimate the local background colour and un-mix so light backgrounds stop leaving grey fringes.
 *
 * Everything is O(pixels) with separable box filters; ~0.5 s for a 12 MP image on one thread.
 */

function boxFilter(src: Float32Array, W: number, H: number, r: number, out?: Float32Array): Float32Array {
  const tmp = new Float32Array(W * H);
  const dst = out ?? new Float32Array(W * H);
  // horizontal
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let sum = 0;
    for (let x = 0; x <= Math.min(r, W - 1); x++) sum += src[row + x];
    for (let x = 0; x < W; x++) {
      const lo = x - r - 1, hi = x + r;
      if (hi < W) sum += src[row + hi];
      if (lo >= 0) sum -= src[row + lo];
      const n = Math.min(hi, W - 1) - Math.max(lo + 1, 0) + 1;
      tmp[row + x] = sum / n;
    }
  }
  // vertical
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = 0; y <= Math.min(r, H - 1); y++) sum += tmp[y * W + x];
    for (let y = 0; y < H; y++) {
      const lo = y - r - 1, hi = y + r;
      if (hi < H) sum += tmp[hi * W + x];
      if (lo >= 0) sum -= tmp[lo * W + x];
      const n = Math.min(hi, H - 1) - Math.max(lo + 1, 0) + 1;
      dst[y * W + x] = sum / n;
    }
  }
  return dst;
}

function upsampleBilinear(mask: Float32Array, S: number, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  const sx = S / W, sy = S / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(S - 1, (y + 0.5) * sy - 0.5);
    const y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(S - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(S - 1, (x + 0.5) * sx - 0.5);
      const x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(S - 1, x0 + 1), wx = fx - x0;
      const a = mask[y0 * S + x0], b = mask[y0 * S + x1], c = mask[y1 * S + x0], d = mask[y1 * S + x1];
      out[y * W + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
    }
  }
  return out;
}

/** Guided filter: refine p using guide I (both 0..1, W×H). */
function guidedFilter(I: Float32Array, p: Float32Array, W: number, H: number, r: number, eps: number): Float32Array {
  const n = W * H;
  const meanI = boxFilter(I, W, H, r);
  const meanP = boxFilter(p, W, H, r);
  const II = new Float32Array(n), Ip = new Float32Array(n);
  for (let i = 0; i < n; i++) { II[i] = I[i] * I[i]; Ip[i] = I[i] * p[i]; }
  const corrI = boxFilter(II, W, H, r, II);
  const corrIp = boxFilter(Ip, W, H, r, Ip);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = corrI[i] - meanI[i] * meanI[i];
    const covIp = corrIp[i] - meanI[i] * meanP[i];
    a[i] = covIp / (varI + eps);
    b[i] = meanP[i] - a[i] * meanI[i];
  }
  const meanA = boxFilter(a, W, H, r, a);
  const meanB = boxFilter(b, W, H, r, b);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = meanA[i] * I[i] + meanB[i];
  return q;
}

export function refineAlpha(rgba: Uint8ClampedArray, W: number, H: number, mask: Float32Array, S: number, edge = 1): Uint8ClampedArray {
  const n = W * H;
  const coarse = upsampleBilinear(mask, S, W, H);

  // luminance guide
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;

  const r = Math.max(3, Math.round(Math.max(W, H) / 300)); // ~7 px at 2048
  const q = guidedFilter(lum, coarse, W, H, r, 1e-3);

  // Only the uncertain band gets refined. Where the model was confident (c near 0 or 1) the coarse
  // value stands — otherwise the guided filter's local linear model punches holes into highlights
  // on dark subjects against light backgrounds (and vice versa).
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = coarse[i];
    const d = Math.abs(c - 0.5);                       // 0 at the edge, 0.5 when certain
    const w = d < 0.3 ? 1 : d > 0.45 ? 0 : (0.45 - d) / 0.15; // 1 inside band, fades to 0 by c=0.05/0.95
    let v = c + (q[i] - c) * w * edge;
    alpha[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }

  // Colour decontamination: local background colour = mean of confidently-background pixels nearby.
  const rr = Math.max(6, r * 3);
  const bgW = new Float32Array(n), bgR = new Float32Array(n), bgG = new Float32Array(n), bgB = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (alpha[i] < 0.05) { bgW[i] = 1; bgR[i] = rgba[i * 4]; bgG[i] = rgba[i * 4 + 1]; bgB[i] = rgba[i * 4 + 2]; }
  }
  boxFilter(bgW, W, H, rr, bgW); boxFilter(bgR, W, H, rr, bgR); boxFilter(bgG, W, H, rr, bgG); boxFilter(bgB, W, H, rr, bgB);

  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    let R = rgba[i * 4], G = rgba[i * 4 + 1], B = rgba[i * 4 + 2];
    if (a > 0.02 && a < 0.98 && bgW[i] > 0.02) {
      const br = bgR[i] / bgW[i], bg = bgG[i] / bgW[i], bb = bgB[i] / bgW[i];
      // C = a·F + (1−a)·B  →  F = (C − (1−a)·B) / a
      const k = Math.min(3, (1 - a) / a);
      R = R + (R - br) * k; G = G + (G - bg) * k; B = B + (B - bb) * k;
      // pull toward the nearest opaque colour a little to avoid over-correction on very thin pixels
      if (a < 0.15) { const m = a / 0.15; R = rgba[i * 4] + (R - rgba[i * 4]) * m; G = rgba[i * 4 + 1] + (G - rgba[i * 4 + 1]) * m; B = rgba[i * 4 + 2] + (B - rgba[i * 4 + 2]) * m; }
    }
    out[i * 4] = R; out[i * 4 + 1] = G; out[i * 4 + 2] = B; out[i * 4 + 3] = Math.round(a * 255);
  }
  return out;
}
