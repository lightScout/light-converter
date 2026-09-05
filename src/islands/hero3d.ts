/**
 * Landing hero — a photo with its subject cut out, and the cut-out floating beside it.
 *   • the card: a translucent plane in the void with a subject-shaped hole; the hole shows the faint checker of transparency
 *   • the piece: the same silhouette, lit, lifted out and drifting beside the card
 *   • haze behind, a pool of light below, dust motes with depth, light ribbons flowing past
 *   • Lenis smooth scroll with snap; scroll lifts the piece further and turns the card
 * Palette: white light, electric blue scatter, deep navy dark.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import Lenis from 'lenis';
import Snap from 'lenis/snap';

const NAVY = 0x030a18;

const UV_VERT = /* glsl */ `
  varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;

/** Shared 2D field: the card outline and the subject silhouette, in card space (x −1…1, y −1.25…1.25). */
const FIELD = /* glsl */ `
  float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
  // three subjects, morphed by blending their distance fields: a bust, a bottle, a plant
  float subjectA(vec2 p){
    float head = length((p - vec2(0.02, 0.40)) * vec2(1.0, 0.90)) - 0.27;
    float neck = sdBox(p - vec2(0.02, 0.06), vec2(0.12, 0.24), 0.08);
    float body = sdBox(p - vec2(0.0, -0.66), vec2(0.66, 0.40), 0.30);
    return smin(smin(head, neck, 0.10), body, 0.16);
  }
  float subjectB(vec2 p){
    float cap = sdBox(p - vec2(0.0, 0.80), vec2(0.13, 0.08), 0.03);
    float neck = sdBox(p - vec2(0.0, 0.50), vec2(0.11, 0.26), 0.05);
    float body = sdBox(p - vec2(0.0, -0.30), vec2(0.34, 0.60), 0.16);
    return smin(smin(cap, neck, 0.04), body, 0.22);
  }
  float leaf(vec2 p, vec2 c, float ang, float len){
    vec2 q = p - c; float cs = cos(ang), sn = sin(ang); q = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
    return length(q * vec2(1.0, 2.6)) - len;
  }
  float subjectC(vec2 p){
    float pot = sdBox(p - vec2(0.0, -0.62), vec2(0.30, 0.30), 0.06);
    float stem = sdBox(p - vec2(0.0, -0.05), vec2(0.035, 0.40), 0.03);
    float l1 = leaf(p, vec2(-0.30, 0.20), 0.75, 0.30);
    float l2 = leaf(p, vec2(0.32, 0.30), -0.70, 0.32);
    float l3 = leaf(p, vec2(0.0, 0.62), 0.0, 0.26);
    float l4 = leaf(p, vec2(-0.22, 0.52), 1.15, 0.22);
    return smin(smin(smin(smin(smin(pot, stem, 0.04), l1, 0.05), l2, 0.05), l3, 0.05), l4, 0.05);
  }
  uniform float uM1; uniform float uM2;
  float subject(vec2 p){ return mix(mix(subjectA(p), subjectB(p), uM1), subjectC(p), uM2); }
  float card(vec2 p){ return sdBox(p, vec2(1.0, 1.25), 0.10); }
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;
const CARD_VERT = /* glsl */ `
  varying vec2 vP; varying vec3 vW; varying vec3 vN;
  void main(){ vP = (uv - 0.5) * vec2(2.0, 2.5); vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
`;
/** The card: translucent photo-like surface with the subject cut out. */
const CARD_FRAG = /* glsl */ `
  uniform float uTime; uniform vec3 uCam; uniform float uOpen;
  varying vec2 vP; varying vec3 vW; varying vec3 vN;
  ${FIELD}
  void main(){
    float dc = card(vP);
    if (dc > 0.0) discard;
    float ds = subject(vP);
    vec3 V = normalize(uCam - vW); vec3 N = normalize(vN); if (dot(N, V) < 0.0) N = -N;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    // the "photo": soft light gradients so it reads as an image, not a slab
    float g1 = smoothstep(-1.4, 1.4, vP.y * 0.7 + vP.x * 0.35);
    float blob = exp(-length(vP - vec2(-0.55, 0.6)) * 1.6) * 0.35 + exp(-length(vP - vec2(0.7, -0.9)) * 1.3) * 0.25;
    vec3 photo = mix(vec3(0.08, 0.16, 0.34), vec3(0.30, 0.46, 0.78), g1) + vec3(0.45, 0.62, 1.0) * blob;
    photo += (hash(floor(vP * 90.0)) - 0.5) * 0.05;                 // grain
    float sheen = pow(0.5 + 0.5 * sin((vP.x * 0.9 + vP.y * 0.6) * 2.2 - uTime * 0.45), 16.0) * 0.22;
    vec3 col = photo * 0.36 + vec3(0.55, 0.72, 1.0) * (fres * 0.22 + sheen);
    float a = 0.8;
    // border: a thin bright edge
    float edge = smoothstep(0.03, 0.0, abs(dc + 0.015));
    col += vec3(0.75, 0.86, 1.0) * edge * 0.45;
    // the hole: transparent — a faint checker, and a lit rim where the cut was made
    float hole = 1.0 - smoothstep(0.0, 0.012, ds);
    vec2 ck = floor(vP * 10.0); float checker = mod(ck.x + ck.y, 2.0);
    vec3 holeCol = vec3(0.10, 0.16, 0.30) * (0.45 + checker * 0.35);
    float rim = smoothstep(0.05, 0.0, abs(ds)) * uOpen;
    col = mix(col, holeCol, hole * uOpen);
    a = mix(a, 0.22, hole * uOpen);
    col += vec3(0.65, 0.82, 1.0) * rim * 0.8;
    gl_FragColor = vec4(col, a);
  }
`;
/** The piece: the subject itself, lit from within, nothing outside the silhouette. */
const PIECE_FRAG = /* glsl */ `
  uniform float uTime; uniform vec3 uCam; uniform float uOpen;
  varying vec2 vP; varying vec3 vW; varying vec3 vN;
  ${FIELD}
  void main(){
    float ds = subject(vP);
    if (ds > 0.02) discard;
    float inside = 1.0 - smoothstep(0.0, 0.012, ds);
    float g1 = smoothstep(-1.4, 1.4, vP.y * 0.7 + vP.x * 0.35);
    float blob = exp(-length(vP - vec2(-0.55, 0.6)) * 1.6) * 0.35 + exp(-length(vP - vec2(0.7, -0.9)) * 1.3) * 0.25;
    vec3 photo = mix(vec3(0.08, 0.16, 0.34), vec3(0.30, 0.46, 0.78), g1) + vec3(0.45, 0.62, 1.0) * blob;
    photo += (hash(floor(vP * 90.0)) - 0.5) * 0.05;
    // lifted: the subject carries the light — brighter, cooler, a soft inner glow
    float core = exp(-length(vP - vec2(0.0, 0.1)) * 1.1);
    float sheen = pow(0.5 + 0.5 * sin((vP.x * 0.9 + vP.y * 0.6) * 2.2 - uTime * 0.45 + 1.0), 16.0) * 0.3;
    vec3 col = photo * 0.55 + vec3(0.7, 0.84, 1.0) * (core * 0.26 + sheen);
    float rim = smoothstep(0.05, 0.0, abs(ds));
    col += vec3(0.85, 0.92, 1.0) * rim * 0.55;
    gl_FragColor = vec4(col, inside * uOpen);
  }
`;
/** Soft radial light (haze, pool, glints). */
const GLOW_FRAG = /* glsl */ `
  uniform float uAlpha; uniform vec3 uCol; varying vec2 vUv;
  void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.2) * uAlpha; gl_FragColor = vec4(uCol * a, a); }
`;
const MOTE_VERT = /* glsl */ `
  attribute float aSeed; uniform float uTime; uniform float uPR; varying float vA;
  void main(){
    vec3 p = position;
    p.x += sin(uTime*(0.15+aSeed*0.2)+aSeed*6.28)*0.3;
    p.y += cos(uTime*(0.12+aSeed*0.15)+aSeed*3.1)*0.25;
    vec4 mv = modelViewMatrix*vec4(p,1.0);
    gl_Position = projectionMatrix*mv;
    gl_PointSize = (12.0 / -mv.z) * uPR * (0.6 + aSeed*0.8);
    vA = (0.5+0.5*sin(uTime*(0.8+aSeed*1.6)+aSeed*9.0)) * smoothstep(40.0, 6.0, -mv.z);
  }
`;
const MOTE_FRAG = /* glsl */ `
  precision mediump float; varying float vA;
  void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.05,d)*vA; gl_FragColor=vec4(vec3(0.78,0.88,1.0)*a,a); }
`;
const RIBBON_FRAG = /* glsl */ `
  uniform float uTime; uniform float uAlpha; uniform float uSeed; varying vec2 vUv;
  void main(){
    float u = vUv.x;
    float pulse = pow(0.5 + 0.5 * sin((u * 5.0 - uTime * 0.3 - uSeed) * 6.2831), 6.0);
    float core = smoothstep(0.5, 0.0, abs(vUv.y - 0.5));
    float ends = smoothstep(0.0, 0.15, u) * smoothstep(1.0, 0.85, u);
    vec3 col = mix(vec3(0.12, 0.42, 1.0), vec3(0.80, 0.92, 1.0), core * core * (0.2 + pulse * 0.8));
    float a = (0.25 + pulse * 1.2) * core * ends * uAlpha;
    gl_FragColor = vec4(col * a, a);
  }
`;

const additive = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
  new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader, uniforms, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });

export function mountHero(canvas: HTMLCanvasElement, opts: { scrollEl?: HTMLElement } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
  catch { canvas.remove(); return () => {}; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(NAVY);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const camBase = new THREE.Vector3(0, 0.9, 10.5);
  camera.position.copy(camBase);
  camera.lookAt(0, 0.9, 0);

  // --- the card and the piece ---
  const CW = 2.4, CH = 3.0;
  const cardU = { uTime: { value: 0 }, uCam: { value: camera.position.clone() }, uOpen: { value: 1 }, uM1: { value: 0 }, uM2: { value: 0 } };
  const plane = new THREE.PlaneGeometry(CW, CH);
  const card = new THREE.Mesh(plane, new THREE.ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: CARD_FRAG, uniforms: cardU, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  const piece = new THREE.Mesh(plane, new THREE.ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: PIECE_FRAG, uniforms: cardU, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  const pieceGlow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.0), additive(GLOW_FRAG, { uAlpha: { value: 0.2 }, uCol: { value: new THREE.Color(0.45, 0.68, 1.0) } }));
  const rig = new THREE.Group();          // the whole composition floats and tilts together
  rig.add(card, piece, pieceGlow);
  rig.position.set(-0.35, 2.35, 0);
  scene.add(rig);

  // --- void dressing: haze behind, a pool of light below ---
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), additive(GLOW_FRAG, { uAlpha: { value: 0.22 }, uCol: { value: new THREE.Color(0.18, 0.40, 0.95) } }));
  haze.position.set(0.5, 1.2, -4);
  scene.add(haze);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), additive(GLOW_FRAG, { uAlpha: { value: 0.16 }, uCol: { value: new THREE.Color(0.25, 0.5, 1.0) } }));
  pool.position.set(0, -2.6, -1);
  scene.add(pool);

  // --- ribbons (flow in with scroll) ---
  const ribbonTime = { value: 0 }, ribbonAlpha = { value: 0 };
  const ribbons = new THREE.Group();
  const paths = [
    [[-18, -1.5, -6], [-8, 0.2, -3], [0, -0.8, -2], [8, 1.2, -4], [18, 3.5, -9]],
    [[-16, 3.6, -10], [-7, 2.2, -6], [2, 3.4, -5], [10, 2.0, -7], [18, -0.5, -10]],
    [[-16, -2.4, -3], [-8, -1.6, 0], [0, -2.2, 1], [8, -1.2, -1], [16, 0.4, -5]],
    [[-20, 5.0, -16], [-10, 3.2, -12], [0, 4.4, -11], [10, 3.0, -13], [20, 5.6, -18]],
  ].map(pts => pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  paths.forEach((pts, i) => {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.6);
    const tube = new THREE.TubeGeometry(curve, 160, 0.06 + i * 0.015, 8, false);
    ribbons.add(new THREE.Mesh(tube, new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader: RIBBON_FRAG, uniforms: { uTime: ribbonTime, uAlpha: ribbonAlpha, uSeed: { value: i * 0.37 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  });
  scene.add(ribbons);

  // --- motes ---
  const COUNT = 500;
  const pos = new Float32Array(COUNT * 3), seed = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) { pos[i*3] = (Math.random()*2-1)*14; pos[i*3+1] = (Math.random()*2-1)*7; pos[i*3+2] = (Math.random()*2-1)*10 - 2; seed[i] = Math.random(); }
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); mg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const moteU = { uTime: { value: 0 }, uPR: { value: renderer.getPixelRatio() } };
  scene.add(new THREE.Points(mg, new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: moteU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));

  // --- post ---
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.6, 0.6);
  composer.addPass(bloom);

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h); bloom.resolution.set(Math.round(w/2), Math.round(h/2));
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize); ro.observe(canvas);

  // --- scroll (Lenis) + pointer ---
  const lenis = reduced ? null : new Lenis({ lerp: 0.08, smoothWheel: true });
  // the three beats are anchors at 0 / ½ / 1 of the journey; each shape is fully formed there, and the scroll settles onto them
  const snap = lenis ? new Snap(lenis, { type: 'proximity', duration: 1.1 }) : null;
  let unsnap: (() => void)[] = [];
  const setSnaps = () => { unsnap.forEach(f => f()); unsnap = []; if (!snap) return; const max = scrollEl.scrollHeight - innerHeight; unsnap = [0, 0.5, 1].map(f => snap.add(Math.round(max * f))); };
  let progress = 0;
  const scrollEl = opts.scrollEl ?? document.documentElement;
  const readScroll = () => { const max = scrollEl.scrollHeight - innerHeight; progress = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0; };
  addEventListener('scroll', readScroll, { passive: true }); readScroll();
  setSnaps(); addEventListener('resize', setSnaps);
  const mouse = new THREE.Vector2(), target = new THREE.Vector2();
  const onMove = (e: PointerEvent) => target.set((e.clientX/innerWidth)*2-1, -((e.clientY/innerHeight)*2-1));
  if (!reduced) addEventListener('pointermove', onMove, { passive: true });
  const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  let mS1 = 0, mA = 0, mB = 0, last = 0;
  let raf = 0, running = true; const start = performance.now();
  const frame = (now: number) => {
    if (!running) return;
    const t = reduced ? 0 : (now - start) / 1000;
    lenis?.raf(now);
    mouse.lerp(target, 0.05);
    const p = progress;

    // the composition floats; scroll turns it and lifts the piece further out of the card
    rig.position.y = 2.3 + Math.sin(t * 0.5) * 0.06 + p * 0.05;
    rig.rotation.set(0.04 + Math.sin(t * 0.22) * 0.03 + mouse.y * 0.05, -0.32 + Math.sin(t * 0.16) * 0.05 + p * 0.55 + mouse.x * 0.08, 0.02 + Math.sin(t * 0.19) * 0.02);
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 0.016); last = now;
    const k = 1 - Math.exp(-dt * 5.5);
    mS1 += (p - mS1) * k;
    // subject morphs between the anchors (0 → ½ → 1), damped: bust → bottle → plant
    mA += (smooth(0.10, 0.42, p) - mA) * k; mB += (smooth(0.58, 0.90, p) - mB) * k;
    cardU.uM1.value = mA; cardU.uM2.value = mB;
    const lift = 0.35 + mS1 * 1.1;              // how far the piece has come out
    piece.position.set(0.7 + lift * 1.1 + Math.sin(t * 0.37) * 0.05, 0.1 + lift * 0.12 + Math.sin(t * 0.5 + 1.2) * 0.05, 0.4 + lift * 0.7 + Math.cos(t * 0.3) * 0.04);
    piece.rotation.set(Math.sin(t * 0.3) * 0.04 - lift * 0.05, 0.08 + lift * 0.12 + Math.sin(t * 0.22) * 0.04, -0.03 + Math.sin(t * 0.26) * 0.03);
    pieceGlow.position.copy(piece.position).add(new THREE.Vector3(0, 0, -0.05)); pieceGlow.rotation.copy(piece.rotation);
    cardU.uTime.value = t; cardU.uCam.value.copy(camera.position);

    ribbonAlpha.value = 0.55 + 0.45 * smooth(0.0, 0.5, p) - 0.3 * smooth(0.8, 1, p);

    camera.position.set(camBase.x + mouse.x * 0.5, camBase.y + mouse.y * 0.3 + p * 0.5, camBase.z - p * 1.0);
    camera.lookAt(0, 0.9 + p * 0.5, 0);

    moteU.uTime.value = t; ribbonTime.value = t;
    composer.render();
    if (reduced && t > 1) return;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const onVis = () => { if (document.hidden) { running = false; cancelAnimationFrame(raf); } else if (!running) { running = true; raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', onVis);

  return () => {
    running = false; cancelAnimationFrame(raf); ro.disconnect(); snap?.destroy(); lenis?.destroy(); removeEventListener('resize', setSnaps);
    removeEventListener('scroll', readScroll); removeEventListener('pointermove', onMove); document.removeEventListener('visibilitychange', onVis);
    composer.dispose(); renderer.dispose();
  };
}
