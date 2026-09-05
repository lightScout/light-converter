/**
 * Landing hero — a glass prism floating in a dark blue void.
 *   • triangular prism: fresnel glass shell, bright edges, specular from the beam
 *   • a piece of the shape floats extracted beside it — lift the subject
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
import Snap from 'lenis/snap';

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
    vec3 col = tint * (0.035 + f * 0.55 + sheen) + vec3(1.0) * spec * 0.3;
    gl_FragColor = vec4(col * uOpacity, 1.0);
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

  const edgeMat = () => new THREE.LineBasicMaterial({ color: 0xe6eeff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const prismEdgeGeo = new THREE.CylinderGeometry(R, R, LEN, 3, 1, false); prismEdgeGeo.rotateX(-Math.PI / 2);
  const edgesA = new THREE.LineSegments(new THREE.EdgesGeometry(prismEdgeGeo, 10), edgeMat());
  const edgesB = new THREE.LineSegments(new THREE.EdgesGeometry(octaGeo, 10), edgeMat());
  const edgesC = new THREE.LineSegments(new THREE.EdgesGeometry(icoGeo, 10), edgeMat());
  // exact meshes carry the resting states (crisp faces); the shell only carries the transitions, crossfading either side
  const prismExact = new THREE.CylinderGeometry(R, R, LEN, 3, 1, false); prismExact.rotateX(-Math.PI / 2);
  const exact = [prismExact, octaGeo, icoGeo].map((g, i) => new THREE.Mesh(g.toNonIndexed(), glassMat({ uM1: { value: 0 }, uM2: { value: 0 }, uOpacity: exactOp[i] })));
  body.add(shell, ...exact, edgesA, edgesB, edgesC);

  // "lift the subject": a piece of the shape, extracted and floating beside it — same shape, same morph, smaller
  const piece = new THREE.Group();
  const pieceShell = new THREE.Mesh(glassGeo, shell.material); pieceShell.frustumCulled = false;
  const pieceExact = exact.map(m => new THREE.Mesh(m.geometry, m.material));
  const pieceEdges = [edgesA, edgesB, edgesC].map(e => new THREE.LineSegments(e.geometry, e.material));
  piece.add(pieceShell, ...pieceExact, ...pieceEdges);
  piece.scale.setScalar(0.34);
  const pieceGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), additive(GLOW_FRAG, { uAlpha: { value: 0.18 }, uCol: { value: new THREE.Color(0.55, 0.75, 1.0) } }));
  const innerGlow = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.4), additive(GLOW_FRAG, { uAlpha: { value: 0.3 }, uCol: { value: new THREE.Color(0.55, 0.75, 1.0) } }));

  prism.add(body, innerGlow, piece, pieceGlow);
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

  const lightWorld = new THREE.Vector3();
  let mS1 = 0, mS2 = 0, last = 0;
  let raf = 0, running = true; const start = performance.now();
  const frame = (now: number) => {
    if (!running) return;
    const t = reduced ? 0 : (now - start) / 1000;
    lenis?.raf(now);
    mouse.lerp(target, 0.05);
    const p = progress;

    // float + a slow tilt; scroll turns it a little further and lifts it.
    prism.position.y = 1.35 + Math.sin(t * 0.5) * 0.12 + p * 0.9;
    prism.rotation.set(
      0.10 + Math.sin(t * 0.22) * 0.06 + p * 0.35 + mouse.y * 0.05,
      0.42 + Math.sin(t * 0.16) * 0.12 + p * 0.35 + mouse.x * 0.08,
      -0.05 + Math.sin(t * 0.19) * 0.04 - p * 0.12,
    );
    // prism → octahedron → icosahedron across the journey; edges crossfade with the shapes
    // morph windows sit between the anchors (0 → ½ → 1) and are damped over time so a flick of the wheel never snaps the shape
    const t1 = smooth(0.10, 0.42, p), t2 = smooth(0.58, 0.90, p);
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 0.016); last = now;
    const k = 1 - Math.exp(-dt * 5.5);
    mS1 += (t1 - mS1) * k; mS2 += (t2 - mS2) * k;
    const m1 = mS1, m2 = mS2;
    morphU.uM1.value = m1; morphU.uM2.value = m2;
    const rest0 = 1 - smooth(0.0, 0.14, m1), rest1 = smooth(0.86, 1.0, m1) * (1 - smooth(0.0, 0.14, m2)), rest2 = smooth(0.86, 1.0, m2);
    exactOp[0].value = rest0; exactOp[1].value = rest1; exactOp[2].value = rest2; shellOp.value = 1 - Math.max(rest0, rest1, rest2);
    (edgesA.material as THREE.LineBasicMaterial).opacity = 0.55 * (1 - smooth(0.0, 0.5, m1));
    (edgesB.material as THREE.LineBasicMaterial).opacity = 0.55 * smooth(0.5, 1.0, m1) * (1 - smooth(0.0, 0.5, m2));
    (edgesC.material as THREE.LineBasicMaterial).opacity = 0.55 * smooth(0.5, 1.0, m2);
    body.rotation.set(m1 * 0.3 + m2 * 0.2, m1 * 0.8 + m2 * 1.2 + t * 0.12 * m1, m1 * 0.15);
    // the extracted piece drifts beside the subject, lifting a little higher with each beat, tumbling slowly
    const lift = 1 + p * 0.6;
    piece.position.set(2.5 + Math.sin(t * 0.37) * 0.15, (0.9 + Math.sin(t * 0.5 + 1.2) * 0.12) * lift, 0.9 + Math.cos(t * 0.3) * 0.2);
    piece.rotation.set(body.rotation.x + t * 0.18, body.rotation.y - t * 0.25, body.rotation.z + 0.4);
    pieceGlow.position.copy(piece.position); pieceGlow.lookAt(camera.position);
    lightWorld.set(-4, 5, 4); prism.localToWorld(lightWorld);
    glassU.uLight.value.copy(lightWorld); glassU.uCam.value.copy(camera.position); glassU.uTime.value = t;

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
