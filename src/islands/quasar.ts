/**
 * Quasar — light emanating from behind the landing headline.
 * One full-screen quad, one fragment shader, no geometry. Transforms/opacity only elsewhere.
 * Loaded lazily; the headline text is already painted before this runs.
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
  uniform vec2 uRes;
  uniform vec2 uCenter;     // 0..1, where the headline sits
  uniform float uIntensity; // 0..1, fades in on load

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    vec2 p = (vUv - uCenter) * vec2(uRes.x / uRes.y, 1.0);
    float r = length(p);
    float a = atan(p.y, p.x);

    // slow breathing
    float breath = 0.92 + 0.08 * sin(uTime * 0.35);

    // core + wide glow
    float core = exp(-r * r * 30.0) * 0.22;
    float glow = exp(-r * 4.2) * 0.30 * breath;

    // rays: sum of two ray fields rotating opposite ways, flicker per ray
    float rot = uTime * 0.018;
    float rays = 0.0;
    for (int i = 0; i < 2; i++) {
      float dir = (i == 0) ? 1.0 : -0.7;
      float n = (i == 0) ? 28.0 : 18.0;
      float ang = a + rot * dir;
      float id = floor((ang / 6.2831853) * n + 0.5);
      float flick = 0.6 + 0.4 * sin(uTime * (0.6 + hash(id) * 0.9) + hash(id * 7.0) * 6.28);
      float beam = pow(max(0.0, cos(ang * n)), 42.0);
      rays += beam * flick * exp(-r * 2.6) * (i == 0 ? 0.20 : 0.12);
    }

    vec3 lavender = vec3(0.682, 0.722, 0.969);
    vec3 peri     = vec3(0.357, 0.424, 0.941);
    vec3 white    = vec3(1.0);

    vec3 col = glow * mix(peri, lavender, 0.6) + rays * lavender + core * white;
    float alpha = clamp(glow * 0.9 + rays + core, 0.0, 1.0) * uIntensity;

    gl_FragColor = vec4(col, alpha);
  }
`;

export function mountQuasar(canvas: HTMLCanvasElement, opts: { centerY?: number } = {}) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
  } catch {
    canvas.remove(); // CSS fallback glow stays
    return () => {};
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uCenter: { value: new THREE.Vector2(0.5, opts.centerY ?? 0.55) },
    uIntensity: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    uniforms.uRes.value.set(w, h);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  let raf = 0;
  let running = true;
  const start = performance.now();
  const frame = (now: number) => {
    if (!running) return;
    const t = (now - start) / 1000;
    uniforms.uTime.value = reduced ? 0 : t;
    uniforms.uIntensity.value = Math.min(1, t / 1.6);
    renderer.render(scene, camera);
    if (reduced && t > 1.8) return; // settle to a static frame
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
    document.removeEventListener('visibilitychange', onVis);
    mat.dispose();
    renderer.dispose();
  };
}
