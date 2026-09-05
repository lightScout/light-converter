/**
 * Landing hero — a glass prism floating in a dark blue void.
 *   • triangular prism: fresnel glass shell, bright edges, specular from the beam
 *   • a white beam enters the left face, bends inside, and leaves the right face as a soft spectral fan
 *   • haze behind it, a pool of light below it, dust motes with depth
 *   • light ribbons flow past as you scroll (beats 2–3)
 *   • Lenis smooth scroll; scroll progress scrubs the tilt and the camera
 * Palette: white light, electric blue scatter, deep navy dark. No terrain — nothing but light.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import Lenis from 'lenis';

const NAVY = 0x030a18;

const UV_VERT = /* glsl */ `
  varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;

/** Glass: fresnel rim + a specular from the light, additive so it reads as light on dark. */
const GLASS_VERT = /* glsl */ `
  attribute vec3 aPosB; attribute vec3 aPosC; attribute vec3 aNormB; attribute vec3 aNormC;
  uniform float uM1; uniform float uM2;
  varying vec3 vN; varying vec3 vW;
  void main(){
    vec3 p = mix(mix(position, aPosB, uM1), aPosC, uM2);
    vec3 n = normalize(mix(mix(normal, aNormB, uM1), aNormC, uM2));
    vN = normalize(mat3(modelMatrix) * n); vec4 wp = modelMatrix * vec4(p,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const GLASS_FRAG = /* glsl */ `
  uniform vec3 uCam; uniform vec3 uLight; uniform float uTime; uniform float uOpacity;
  varying vec3 vN; varying vec3 vW;
  void main(){
    // flat facets from screen-space derivatives: crisp faces even mid-morph
    vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
    vec3 V = normalize(uCam - vW);
    if (dot(N, V) < 0.0) N = -N;
    float f = pow(1.0 - max(dot(N, V), 0.0), 2.6);
    vec3 L = normalize(uLight - vW); vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 160.0);
    // slow sheen sweeping across the faces
    float sheen = pow(0.5 + 0.5 * sin(dot(vW, vec3(0.9, 1.4, 0.3)) * 1.2 - uTime * 0.5), 14.0) * 0.12;
    vec3 tint = mix(vec3(0.22, 0.42, 0.85), vec3(0.85, 0.92, 1.0), f);
    vec3 col = tint * (0.035 + f * 0.55 + sheen) + vec3(1.0) * spec * 0.9;
    gl_FragColor = vec4(col * uOpacity, 1.0);
  }
`;

/** A segment of light: soft across, fades in along, tinted. */
const SEG_FRAG = /* glsl */ `
  uniform float uAlpha; uniform vec3 uCol; uniform float uFadeIn; uniform float uFadeOut; varying vec2 vUv;
  void main(){
    float across = smoothstep(0.5, 0.0, abs(vUv.y - 0.5));
    across = across * across;
    float along = smoothstep(0.0, uFadeIn, vUv.x) * smoothstep(1.0, 1.0 - uFadeOut, vUv.x);
    float a = across * along * uAlpha;
    gl_FragColor = vec4(uCol * a, a);
  }
`;
/** The fan leaving the prism: mostly white light with a spectral fringe, spreading and thinning. */
const FAN_FRAG = /* glsl */ `
  uniform float uAlpha; varying vec2 vUv;
  vec3 hue(float h){ vec3 c = clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); return c*c*(3.0-2.0*c); }
  void main(){
    float u = vUv.x, v = vUv.y;
    float spread = mix(0.06, 0.5, u);               // half-width grows along the fan
    float d = abs(v - 0.5) / spread;                // 0 centre .. 1 edge
    float body = smoothstep(1.0, 0.0, d);
    vec3 spectral = hue(0.72 - (v - 0.5 + spread) / (2.0 * spread) * 0.72);
    vec3 col = mix(vec3(0.92, 0.96, 1.0), spectral, smoothstep(0.1, 0.7, u) * 0.55);
    float a = body * body * (1.0 - u) * (1.0 - u) * uAlpha * 0.8;
    gl_FragColor = vec4(col * a, a);
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

/** Project every vertex of a base sphere onto a convex polyhedron given as planes (n·x = d). */
type Plane = { n: THREE.Vector3; d: number };
function projectOnto(base: THREE.BufferGeometry, planes: Plane[]) {
  const src = base.getAttribute('position') as THREE.BufferAttribute;
  const pos = new Float32Array(src.count * 3), nor = new Float32Array(src.count * 3);
  const dir = new THREE.Vector3();
  for (let i = 0; i < src.count; i++) {
    dir.fromBufferAttribute(src, i).normalize();
    let best = Infinity, bn = planes[0].n;
    for (const pl of planes) { const c = pl.n.dot(dir); if (c > 1e-6) { const s = pl.d / c; if (s < best) { best = s; bn = pl.n; } } }
    pos[i*3] = dir.x * best; pos[i*3+1] = dir.y * best; pos[i*3+2] = dir.z * best;
    nor[i*3] = bn.x; nor[i*3+1] = bn.y; nor[i*3+2] = bn.z;
  }
  return { pos, nor };
}
function facePlanes(geo: THREE.BufferGeometry): Plane[] {
  const g = geo.index ? geo.toNonIndexed() : geo; const p = g.getAttribute('position');
  const out: Plane[] = []; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    out.push({ n: n.clone(), d: n.dot(a) });
  }
  return out;
}

/** A light segment from a to b (in the XY plane of its parent), with a given width. */
function segment(a: THREE.Vector2, b: THREE.Vector2, width: number, mat: THREE.Material) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, width), mat);
  m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
  m.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
  return m;
}

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

  // --- prism ---
  const R = 1.35, LEN = 3.2;                       // triangle circumradius, prism length
  const prism = new THREE.Group();                 // world placement (float, tilt, scroll)
  const body = new THREE.Group();                  // the glass, triangle in XY, axis along z, apex up
  const glassU = { uCam: { value: camera.position.clone() }, uLight: { value: new THREE.Vector3() }, uTime: { value: 0 } };
  // three convex shapes share one vertex set (a projected sphere), so the shader can morph between them
  const OCT = 2.0, ICO = 1.75;
  const prismPlanes: Plane[] = [30, 150, 270].map(deg => ({ n: new THREE.Vector3(Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180), 0), d: R / 2 }))
    .concat([{ n: new THREE.Vector3(0, 0, 1), d: LEN / 2 }, { n: new THREE.Vector3(0, 0, -1), d: LEN / 2 }]);
  const octaGeo = new THREE.OctahedronGeometry(OCT), icoGeo = new THREE.IcosahedronGeometry(ICO);
  const base = new THREE.IcosahedronGeometry(1, 48).toNonIndexed(); // detail = edge segments: 20·49² triangles
  const A = projectOnto(base, prismPlanes), B = projectOnto(base, facePlanes(octaGeo)), C = projectOnto(base, facePlanes(icoGeo));
  const glassGeo = new THREE.BufferGeometry();
  glassGeo.setAttribute('position', new THREE.BufferAttribute(A.pos, 3)); glassGeo.setAttribute('normal', new THREE.BufferAttribute(A.nor, 3));
  glassGeo.setAttribute('aPosB', new THREE.BufferAttribute(B.pos, 3)); glassGeo.setAttribute('aNormB', new THREE.BufferAttribute(B.nor, 3));
  glassGeo.setAttribute('aPosC', new THREE.BufferAttribute(C.pos, 3)); glassGeo.setAttribute('aNormC', new THREE.BufferAttribute(C.nor, 3));
  glassGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  const morphU = { uM1: { value: 0 }, uM2: { value: 0 } };
  const glassMat = (extra: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({ vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG, uniforms: { ...glassU, ...extra }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const shellOp = { value: 0 }, exactOp = [{ value: 1 }, { value: 0 }, { value: 0 }];
  const shell = new THREE.Mesh(glassGeo, glassMat({ ...morphU, uOpacity: shellOp }));
  shell.frustumCulled = false;
  // exact meshes for the three resting states (the projected shell only carries the transitions)
  const prismExact = new THREE.CylinderGeometry(R, R, LEN, 3, 1, false); prismExact.rotateX(-Math.PI / 2);
  const exact = [prismExact, octaGeo, icoGeo].map((g, i) => new THREE.Mesh(g.toNonIndexed(), glassMat({ uM1: { value: 0 }, uM2: { value: 0 }, uOpacity: exactOp[i] })));
  const edgeMat = () => new THREE.LineBasicMaterial({ color: 0xe6eeff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const prismEdgeGeo = new THREE.CylinderGeometry(R, R, LEN, 3, 1, false); prismEdgeGeo.rotateX(-Math.PI / 2);
  const edgesA = new THREE.LineSegments(new THREE.EdgesGeometry(prismEdgeGeo, 10), edgeMat());
  const edgesB = new THREE.LineSegments(new THREE.EdgesGeometry(octaGeo, 10), edgeMat());
  const edgesC = new THREE.LineSegments(new THREE.EdgesGeometry(icoGeo, 10), edgeMat());
  body.add(shell, ...exact, edgesA, edgesB, edgesC);

  // the light path — computed on the triangle (apex (0,R), base at y=-R/2, half-width R·sin60)
  const hw = R * 0.8660;                           // R·sin(60°)
  const leftAt = (y: number) => -hw * (R - y) / (1.5 * R);
  const rightAt = (y: number) => hw * (R - y) / (1.5 * R);
  const entry = new THREE.Vector2(leftAt(0.32), 0.32);
  const exit = new THREE.Vector2(rightAt(-0.05), -0.05);
  const from = new THREE.Vector2(-7.5, 1.25);
  const light = new THREE.Group();                 // beam + internal path + fan, in the prism's plane
  const beamU = { uAlpha: { value: 1 }, uCol: { value: new THREE.Color(0.95, 0.97, 1.0) }, uFadeIn: { value: 0.6 }, uFadeOut: { value: 0.02 } };
  const innerU = { uAlpha: { value: 1 }, uCol: { value: new THREE.Color(0.75, 0.88, 1.0) }, uFadeIn: { value: 0.05 }, uFadeOut: { value: 0.05 } };
  light.add(segment(from, entry, 0.13, additive(SEG_FRAG, beamU)));
  light.add(segment(entry, exit, 0.34, additive(SEG_FRAG, innerU)));
  // dispersion: six rays leave the exit at slightly different angles, violet bent most, red least
  const rays: THREE.Mesh[] = [];
  const rayU: { uAlpha: THREE.IUniform }[] = [];
  const spectrum = [[0.62, 0.45, 1.0], [0.45, 0.60, 1.0], [0.55, 0.85, 1.0], [0.70, 1.0, 0.75], [1.0, 0.92, 0.55], [1.0, 0.65, 0.55]];
  spectrum.forEach((c, i) => {
    const ang = -0.52 + i * 0.045;
    const u = { uAlpha: { value: 0.5 }, uCol: { value: new THREE.Color(c[0], c[1], c[2]) }, uFadeIn: { value: 0.03 }, uFadeOut: { value: 0.92 } };
    const end = new THREE.Vector2(exit.x + Math.cos(ang) * 7.5, exit.y + Math.sin(ang) * 7.5);
    const m = segment(exit, end, 0.20, additive(SEG_FRAG, u));
    rays.push(m); rayU.push(u); light.add(m);
  });
  const glintU = { uAlpha: { value: 0.9 }, uCol: { value: new THREE.Color(0.9, 0.95, 1.0) } };
  for (const pt of [entry, exit]) { const g = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), additive(GLOW_FRAG, glintU)); g.position.set(pt.x, pt.y, 0.02); light.add(g); }
  const innerGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.0), additive(GLOW_FRAG, { uAlpha: { value: 0.35 }, uCol: { value: new THREE.Color(0.55, 0.75, 1.0) } }));
  innerGlow.position.set(0, 0.1, 0);
  light.add(innerGlow);

  prism.add(body, light);
  prism.position.set(0, 1.35, 0);
  scene.add(prism);

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
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.6, 0.55);
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
  let progress = 0;
  const scrollEl = opts.scrollEl ?? document.documentElement;
  const readScroll = () => { const max = scrollEl.scrollHeight - innerHeight; progress = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0; };
  addEventListener('scroll', readScroll, { passive: true }); readScroll();
  const mouse = new THREE.Vector2(), target = new THREE.Vector2();
  const onMove = (e: PointerEvent) => target.set((e.clientX/innerWidth)*2-1, -((e.clientY/innerHeight)*2-1));
  if (!reduced) addEventListener('pointermove', onMove, { passive: true });
  const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  const lightWorld = new THREE.Vector3();
  let raf = 0, running = true; const start = performance.now();
  const frame = (now: number) => {
    if (!running) return;
    const t = reduced ? 0 : (now - start) / 1000;
    lenis?.raf(now);
    mouse.lerp(target, 0.05);
    const p = progress;

    // float + a slow tilt; scroll turns it a little further and lifts it. Never a full spin — the beam must stay readable.
    prism.position.y = 1.35 + Math.sin(t * 0.5) * 0.12 + p * 0.9;
    prism.rotation.set(
      0.10 + Math.sin(t * 0.22) * 0.06 + p * 0.35 + mouse.y * 0.05,
      0.42 + Math.sin(t * 0.16) * 0.12 + p * 0.35 + mouse.x * 0.08,
      -0.05 + Math.sin(t * 0.19) * 0.04 - p * 0.12,
    );
    // prism → octahedron → icosahedron across the journey; edges crossfade with the shapes
    const m1 = smooth(0.2, 0.45, p), m2 = smooth(0.55, 0.82, p);
    morphU.uM1.value = m1; morphU.uM2.value = m2;
    const rest0 = 1 - smooth(0.0, 0.04, m1), rest1 = smooth(0.96, 1.0, m1) * (1 - smooth(0.0, 0.04, m2)), rest2 = smooth(0.96, 1.0, m2);
    exactOp[0].value = rest0; exactOp[1].value = rest1; exactOp[2].value = rest2; shellOp.value = 1 - Math.max(rest0, rest1, rest2);
    (edgesA.material as THREE.LineBasicMaterial).opacity = 0.55 * (1 - smooth(0.2, 0.3, p));
    (edgesB.material as THREE.LineBasicMaterial).opacity = 0.55 * smooth(0.38, 0.45, p) * (1 - smooth(0.55, 0.64, p));
    (edgesC.material as THREE.LineBasicMaterial).opacity = 0.55 * smooth(0.74, 0.82, p);
    body.rotation.set(m1 * 0.3 + m2 * 0.2, m1 * 0.8 + m2 * 1.2 + t * 0.12 * m1, m1 * 0.15);
    const beamOn = 1 - smooth(0.12, 0.28, p);
    beamU.uAlpha.value = 0.9 * beamOn; innerU.uAlpha.value = 0.8 * beamOn; glintU.uAlpha.value = 0.55 * beamOn;
    rayU.forEach((u, i) => { u.uAlpha.value = (0.62 + 0.1 * Math.sin(t * 1.1 + i)) * beamOn; });
    lightWorld.set(entry.x, entry.y, 0.4); prism.localToWorld(lightWorld);
    glassU.uLight.value.copy(lightWorld); glassU.uCam.value.copy(camera.position); glassU.uTime.value = t;

    ribbonAlpha.value = smooth(0.15, 0.5, p) * (1 - 0.3 * smooth(0.8, 1, p));

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
    running = false; cancelAnimationFrame(raf); ro.disconnect(); lenis?.destroy();
    removeEventListener('scroll', readScroll); removeEventListener('pointermove', onMove); document.removeEventListener('visibilitychange', onVis);
    composer.dispose(); renderer.dispose();
  };
}
