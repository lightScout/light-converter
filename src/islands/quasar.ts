/**
 * Landing scene — one full-screen shader, one draw call.
 * Background (living sky: drifting mist, a faint planet, a breathing horizon, twinkling stars)
 * and the quasar behind the headline (glow, core, two counter-rotating ray fields with
 * chromatic dispersion) are the same fragment. Pointer moves the scene in parallax.
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2  uRes;
  uniform vec2  uCenter;    // headline centre, 0..1
  uniform vec2  uMouse;     // -1..1
  uniform float uIntensity; // fade-in

  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash2(i), b = hash2(i + vec2(1.0, 0.0)), c = hash2(i + vec2(0.0, 1.0)), d = hash2(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = m * p * 2.03 + 0.7; a *= 0.5; }
    return v;
  }

  void main() {
    float aspect = uRes.x / uRes.y;
    vec2 uv = vUv;
    vec2 par = uMouse * 0.012;
    float t = uTime;

    // sky
    vec3 top = vec3(0.028, 0.040, 0.120);
    vec3 mid = vec3(0.070, 0.095, 0.240);
    vec3 low = vec3(0.180, 0.220, 0.430);
    float horizon = 0.34 + par.y * 0.6;
    float h = uv.y;
    vec3 col = mix(low, mid, smoothstep(horizon - 0.10, horizon + 0.25, h));
    col = mix(col, top, smoothstep(horizon + 0.25, 1.0, h));

    // stars
    vec2 sp = (uv + par * 0.5) * vec2(aspect, 1.0) * 220.0;
    vec2 cell = floor(sp);
    float sh = hash2(cell);
    if (sh > 0.986 && h > horizon + 0.05) {
      vec2 f = fract(sp) - 0.5;
      float d = length(f);
      float tw = 0.55 + 0.45 * sin(t * (0.8 + hash2(cell + 7.0) * 2.0) + hash2(cell + 3.0) * 6.28);
      col += vec3(0.9, 0.95, 1.0) * smoothstep(0.18, 0.0, d) * tw * 0.7 * smoothstep(horizon + 0.05, horizon + 0.3, h);
    }

    // planet
    vec2 pc = vec2(0.5 + par.x * 1.4, 0.86 + par.y * 1.2);
    vec2 pd = (uv - pc) * vec2(aspect, 1.0);
    float pr = 0.13;
    float pdist = length(pd);
    float disc = smoothstep(pr, pr - 0.004, pdist);
    float lit = smoothstep(-0.3, 0.9, -pd.y / pr) * 0.45 + 0.35;
    float tex = fbm(pd * 9.0 + 3.0) * 0.25;
    vec3 planet = vec3(0.30, 0.36, 0.62) * (lit + tex);
    col = mix(col, planet, disc * 0.7);
    col += vec3(0.55, 0.62, 0.95) * smoothstep(pr + 0.05, pr - 0.01, pdist) * (1.0 - disc) * 0.18;

    // horizon glow (breathing)
    float breath = 0.85 + 0.15 * sin(t * 0.35);
    float hg = exp(-abs(h - horizon) * 30.0) * 0.7 + exp(-abs(h - horizon) * 8.0) * 0.3;
    col += vec3(0.98, 0.90, 0.72) * hg * 0.16 * breath * (0.35 + 0.65 * exp(-abs(uv.x - 0.5) * 2.2));

    // mist
    vec2 mp = (uv + par) * vec2(aspect, 1.0);
    float m1 = fbm(mp * 2.2 + vec2(t * 0.012, -t * 0.004));
    float m2 = fbm(mp * 4.5 + vec2(-t * 0.02, t * 0.006) + 9.0);
    float below = smoothstep(horizon + 0.22, horizon - 0.35, h);
    float mist = smoothstep(0.28, 0.80, m1 * 0.7 + m2 * 0.3) * below;
    vec3 mistCol = mix(vec3(0.55, 0.60, 0.85), vec3(0.85, 0.82, 0.95), smoothstep(horizon - 0.15, horizon + 0.05, h));
    col = mix(col, mistCol, mist * 0.7);
    float wisp = smoothstep(0.55, 0.9, fbm(mp * 3.0 + vec2(t * 0.03, 0.0) + 21.0)) * smoothstep(horizon + 0.35, horizon, h) * smoothstep(horizon - 0.1, horizon + 0.05, h);
    col += vec3(0.7, 0.72, 0.9) * wisp * 0.12;

    // ridges
    float ridge1 = horizon - 0.18 + 0.06 * fbm(vec2(mp.x * 1.6 + 1.0, 0.0)) + 0.02 * sin(mp.x * 9.0);
    float ridge2 = horizon - 0.30 + 0.09 * fbm(vec2(mp.x * 1.1 + 5.0, 0.0));
    col = mix(col, vec3(0.045, 0.06, 0.14), smoothstep(ridge1 + 0.01, ridge1 - 0.02, h) * 0.55);
    col = mix(col, vec3(0.03, 0.04, 0.10), smoothstep(ridge2 + 0.01, ridge2 - 0.03, h) * 0.75);

    // quasar
    vec2 p = (uv - (uCenter + par * 0.4)) * vec2(aspect, 1.0);
    float r = length(p);
    float a = atan(p.y, p.x);
    float core = exp(-r * r * 30.0) * 0.18;
    float glow = exp(-r * 4.2) * 0.26 * (0.92 + 0.08 * sin(t * 0.35));
    float rot = t * 0.018;
    float rays = 0.0;
    for (int i = 0; i < 2; i++) {
      float dir = (i == 0) ? 1.0 : -0.7;
      float n = (i == 0) ? 28.0 : 18.0;
      float ang = a + rot * dir;
      float id = floor((ang / 6.2831853) * n + 0.5);
      float flick = 0.6 + 0.4 * sin(t * (0.6 + hash(id) * 0.9) + hash(id * 7.0) * 6.28);
      float beam = pow(max(0.0, cos(ang * n)), 42.0);
      rays += beam * flick * exp(-r * 6.0) * (i == 0 ? 0.12 : 0.07);
    }
    float fall = exp(-r * 6.0) * 0.06, n28 = 28.0;
    vec3 disp = vec3(
      pow(max(0.0, cos((a + rot + 0.006) * n28)), 42.0),
      pow(max(0.0, cos((a + rot) * n28)), 42.0),
      pow(max(0.0, cos((a + rot - 0.006) * n28)), 42.0)) * fall;
    vec3 lav = vec3(0.874, 0.898, 1.0), peri = vec3(0.43, 0.49, 0.96);
    col += glow * mix(peri, lav, 0.75) + rays * 0.9 + disp + core;

    // god rays into the mist
    {
      vec2 d = uv - uCenter;
      float ang2 = atan(d.y, d.x);
      float fan = smoothstep(-2.6, -1.6, ang2) * smoothstep(-0.5, -1.5, ang2);
      float rr = length(d * vec2(aspect, 1.0));
      col += vec3(0.9, 0.92, 1.0) * pow(max(0.0, cos(ang2 * 22.0 + t * 0.05)), 8.0) * fan * exp(-rr * 3.0) * 0.05;
    }

    col *= 0.78;
    col += (hash2(uv * uRes + fract(t)) - 0.5) * 0.02;
    gl_FragColor = vec4(col * uIntensity, 1.0);
  }
`;

export function mountQuasar(canvas: HTMLCanvasElement, opts: { centerY?: number } = {}) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: 'low-power' });
  } catch {
    canvas.remove();
    return () => {};
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uCenter: { value: new THREE.Vector2(0.5, opts.centerY ?? 0.55) },
    uMouse: { value: new THREE.Vector2(0, 0) },
    uIntensity: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, depthWrite: false, depthTest: false });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const target = new THREE.Vector2(0, 0);
  const onMove = (e: PointerEvent) => { target.set((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1)); };
  if (!reduced) addEventListener('pointermove', onMove, { passive: true });

  let raf = 0, running = true;
  const start = performance.now();
  const frame = (now: number) => {
    if (!running) return;
    const t = (now - start) / 1000;
    uniforms.uTime.value = reduced ? 0 : t;
    uniforms.uIntensity.value = Math.min(1, t / 1.8);
    uniforms.uMouse.value.lerp(target, 0.04);
    renderer.render(scene, camera);
    if (reduced && t > 2) return;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const onVis = () => {
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!running) { running = true; raf = requestAnimationFrame(frame); }
  };
  document.addEventListener('visibilitychange', onVis);

  return () => {
    running = false;
    cancelAnimationFrame(raf);
    ro.disconnect();
    removeEventListener('pointermove', onMove);
    document.removeEventListener('visibilitychange', onVis);
    mat.dispose();
    renderer.dispose();
  };
}
