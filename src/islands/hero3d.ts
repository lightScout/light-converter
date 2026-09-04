/**
 * Landing hero — a real Three.js scene.
 *   • a floating glass prism (triangular) with a white light core; a white beam enters it and leaves as a spectrum
 *   • blue water: noise-displaced plane with fresnel, a reflection column under the prism, sparkle
 *   • two mountain ridges, rim-lit by the prism
 *   • light ribbons that flow across the valley as you scroll (beats 2–3)
 *   • dust motes with depth, exponential fog, bloom
 *   • Lenis smooth scroll; scroll progress scrubs prism rotation and camera
 * Palette: white light, electric blue scatter, deep navy dark.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import Lenis from 'lenis';

const NAVY = 0x030a18;
const FOG = 0x061024;

const NOISE = /* glsl */ `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}
  float snoise(vec2 v){
    const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
    vec2 i=floor(v+dot(v,C.yy)); vec2 x0=v-i+dot(i,C.xx);
    vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);
    vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1; i=mod289(i);
    vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
    vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0); m=m*m; m=m*m;
    vec3 x=2.0*fract(p*C.www)-1.0; vec3 h=abs(x)-0.5; vec3 ox=floor(x+0.5); vec3 a0=x-ox;
    m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
    vec3 g; g.x=a0.x*x0.x+h.x*x0.y; g.yz=a0.yz*x12.xz+h.yz*x12.yw; return 130.0*dot(m,g);
  }
  float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*snoise(p); p=p*2.02+11.3; a*=0.5;} return v; }
`;

function withFog(mat: THREE.ShaderMaterial, scene: THREE.Scene, vertAnchor: string, fragAnchor: string) {
  mat.fog = true;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = '#include <fog_pars_vertex>\n' + sh.vertexShader.replace(vertAnchor, vertAnchor + '\n vec4 mvPosition = viewMatrix * wp;\n #include <fog_vertex>');
    sh.fragmentShader = '#include <fog_pars_fragment>\n' + sh.fragmentShader.replace(fragAnchor, fragAnchor + '\n #include <fog_fragment>');
    Object.assign(sh.uniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.fog));
    sh.uniforms.fogColor.value = (scene.fog as THREE.FogExp2).color; sh.uniforms.fogDensity.value = (scene.fog as THREE.FogExp2).density;
  };
}

const WATER_VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vPos; varying vec3 vWorld; varying float vWave;
  ${NOISE}
  void main(){
    vec3 p = position;
    float w = fbm(vec2(p.x*0.35 + uTime*0.06, p.y*0.35 - uTime*0.04)) * 0.10
            + snoise(vec2(p.x*1.4 - uTime*0.12, p.y*1.4 + uTime*0.08)) * 0.025;
    p.z += w;
    vWave = w; vPos = p;
    vec4 wp = modelMatrix * vec4(p,1.0); vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const WATER_FRAG = /* glsl */ `
  uniform float uTime; uniform vec3 uLightPos; uniform vec3 uCam;
  varying vec3 vPos; varying vec3 vWorld; varying float vWave;
  ${NOISE}
  void main(){
    float e = 0.05;
    float hx = fbm(vec2((vPos.x+e)*0.35 + uTime*0.06, vPos.y*0.35 - uTime*0.04))*0.10 - vWave;
    float hy = fbm(vec2(vPos.x*0.35 + uTime*0.06, (vPos.y+e)*0.35 - uTime*0.04))*0.10 - vWave;
    vec3 n = normalize(vec3(-hx/e*0.22, 1.0, -hy/e*0.22));
    vec3 V = normalize(uCam - vWorld);
    float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    vec3 base = vec3(0.012, 0.030, 0.075);
    vec3 sky  = vec3(0.035, 0.075, 0.19);
    vec3 col = mix(base, sky, fres * 0.3);
    vec2 d = vWorld.xz - uLightPos.xz;
    float column = exp(-abs(d.x + n.x * 0.8) * 2.2) * exp(-max(0.0, d.y) * 0.25) * smoothstep(0.0, -1.5, -d.y + 40.0);
    float ripple = 0.6 + 0.4 * snoise(vec2(vWorld.z*3.0 - uTime*0.5, vWorld.x*1.5));
    col += vec3(0.55, 0.75, 1.0) * column * ripple * 0.45;
    vec3 L = normalize(uLightPos - vWorld);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(n, H), 0.0), 220.0);
    col += vec3(0.85, 0.92, 1.0) * spec * 0.45;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const MOUNTAIN_VERT = /* glsl */ `
  uniform float uSide; varying float vH; varying vec3 vWorld; varying vec3 vN;
  ${NOISE}
  void main(){
    vec3 p = position;
    float ridge = fbm(vec2(p.x*0.12 + uSide*7.0, 3.0)) * 0.5 + 0.5;
    float h = ridge * 6.0 * smoothstep(0.0, 1.0, abs(p.x)/12.0) + fbm(p.xy*0.4)*0.6;
    p.z += max(0.0, h) * smoothstep(1.0, 9.0, p.y);
    vH = p.z; vec4 wp = modelMatrix*vec4(p,1.0); vWorld = wp.xyz; vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix*viewMatrix*wp;
  }
`;
const MOUNTAIN_FRAG = /* glsl */ `
  uniform vec3 uLightPos; varying float vH; varying vec3 vWorld; varying vec3 vN;
  void main(){
    vec3 L = normalize(uLightPos - vWorld);
    float rim = pow(max(0.0, 1.0 - abs(dot(vN, L))), 2.0);
    float facing = max(0.0, dot(vN, L));
    float crest = smoothstep(2.0, 6.0, vH);
    vec3 col = vec3(0.010, 0.022, 0.050) + vec3(0.55, 0.72, 1.0) * (facing * 0.05 + rim * 0.03 + crest * 0.04) * exp(-length(uLightPos - vWorld) * 0.05);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const MOTE_VERT = /* glsl */ `
  attribute float aSeed; uniform float uTime; uniform float uPR; varying float vA;
  void main(){
    vec3 p = position;
    p.x += sin(uTime*(0.15+aSeed*0.2)+aSeed*6.28)*0.4;
    p.y += cos(uTime*(0.12+aSeed*0.15)+aSeed*3.1)*0.3;
    vec4 mv = modelViewMatrix*vec4(p,1.0);
    gl_Position = projectionMatrix*mv;
    gl_PointSize = (14.0 / -mv.z) * uPR * (0.6 + aSeed*0.8);
    vA = (0.5+0.5*sin(uTime*(0.8+aSeed*1.6)+aSeed*9.0)) * smoothstep(60.0, 10.0, -mv.z);
  }
`;
const MOTE_FRAG = /* glsl */ `
  precision mediump float; varying float vA;
  void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.05,d)*vA; gl_FragColor=vec4(vec3(0.78,0.88,1.0)*a,a); }
`;

const UV_VERT = /* glsl */ `
  varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;
/** Light ribbon — a tube whose brightness travels along its length. */
const RIBBON_FRAG = /* glsl */ `
  uniform float uTime; uniform float uAlpha; uniform float uSeed; varying vec2 vUv;
  void main(){
    float u = vUv.x;
    float pulse = pow(0.5 + 0.5 * sin((u * 6.0 - uTime * 0.35 - uSeed) * 6.2831), 6.0);
    float core = smoothstep(0.5, 0.0, abs(vUv.y - 0.5));
    float ends = smoothstep(0.0, 0.12, u) * smoothstep(1.0, 0.85, u);
    vec3 col = mix(vec3(0.12, 0.42, 1.0), vec3(0.80, 0.92, 1.0), core * core * (0.2 + pulse * 0.8));
    float a = (0.25 + pulse * 1.2) * core * ends * uAlpha;
    gl_FragColor = vec4(col * a, a);
  }
`;
/** Spectrum fan — the beam leaving the prism split into colour. */
const FAN_FRAG = /* glsl */ `
  uniform float uAlpha; varying vec2 vUv;
  vec3 hue(float h){ vec3 c = clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); return c*c*(3.0-2.0*c); }
  void main(){
    float u = vUv.x;
    float v = vUv.y;
    vec3 col = mix(vec3(1.0), hue(v * 0.78), smoothstep(0.02, 0.35, u));
    float edge = smoothstep(0.0, 0.08, v) * smoothstep(1.0, 0.92, v);
    float a = (1.0 - u) * (0.75 - 0.4 * u) * edge * uAlpha;
    gl_FragColor = vec4(col * a, a);
  }
`;
const BEAM_FRAG = /* glsl */ `
  uniform float uAlpha; varying vec2 vUv;
  void main(){
    float across = smoothstep(0.5, 0.0, abs(vUv.y - 0.5));
    float along = smoothstep(0.0, 0.35, vUv.x);
    float a = across * across * along * uAlpha;
    gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * a, a);
  }
`;

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
  scene.fog = new THREE.FogExp2(FOG, 0.028);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  const camBase = new THREE.Vector3(0, 2.4, 14);
  camera.position.copy(camBase);
  camera.lookAt(0, 2.2, 0);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // --- prism (triangular) ---
  const prism = new THREE.Group();
  const prismGeo = new THREE.CylinderGeometry(1.35, 1.35, 4.4, 3, 1).toNonIndexed();
  prismGeo.computeVertexNormals();
  const glass = new THREE.Mesh(prismGeo, new THREE.MeshPhysicalMaterial({
    color: 0x7f96cc, metalness: 0.1, roughness: 0.2, transparent: true, opacity: 0.42, depthWrite: false,
    iridescence: 0.6, iridescenceIOR: 1.3, envMapIntensity: 1.0, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide,
  }));
  const coreGeo = new THREE.CylinderGeometry(0.75, 0.75, 2.6, 3, 1).toNonIndexed(); coreGeo.computeVertexNormals();
  const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xdfe8ff }));
  const coreGlow = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 3), new THREE.MeshBasicMaterial({ color: 0xbfd6ff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(prismGeo, 20), new THREE.LineBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.35 }));
  core.renderOrder = 1; coreGlow.renderOrder = 2; glass.renderOrder = 3; edges.renderOrder = 4;
  const body = new THREE.Group(); body.add(glass, core, coreGlow, edges);
  body.rotation.x = Math.PI / 2; // prism axis along z: the triangle faces the camera, the beam crosses its side faces

  // beam in (white) and spectrum out — in the prism's local space so they stay attached
  const beamU = { uAlpha: { value: 1 } }, fanU = { uAlpha: { value: 1 } };
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.22), new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader: BEAM_FRAG, uniforms: beamU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beam.position.set(-5.2, 0.35, 0); beam.rotation.z = -0.12;
  const fan = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.6), new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader: FAN_FRAG, uniforms: fanU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  fan.position.set(5.2, -0.9, 0); fan.rotation.z = -0.32;
  prism.add(body, beam, fan);
  prism.position.set(0, 3.4, 0);
  scene.add(prism);
  const prismLight = new THREE.PointLight(0xcfe0ff, 30, 40, 1.6);
  prismLight.position.copy(prism.position);
  scene.add(prismLight);

  // --- water ---
  const waterU = { uTime: { value: 0 }, uLightPos: { value: prism.position.clone() }, uCam: { value: camera.position.clone() } };
  const waterMat = new THREE.ShaderMaterial({ vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, uniforms: waterU });
  withFog(waterMat, scene, 'gl_Position = projectionMatrix * viewMatrix * wp;', 'gl_FragColor = vec4(col, 1.0);');
  const water = new THREE.Mesh(new THREE.PlaneGeometry(120, 120, 160, 160), waterMat);
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  // --- mountains ---
  const mkMountain = (side: number) => {
    const mat = new THREE.ShaderMaterial({ vertexShader: MOUNTAIN_VERT, fragmentShader: MOUNTAIN_FRAG, uniforms: { uSide: { value: side }, uLightPos: { value: prism.position.clone() } } });
    withFog(mat, scene, 'gl_Position = projectionMatrix*viewMatrix*wp;', 'gl_FragColor = vec4(col, 1.0);');
    const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 30, 120, 90), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(side * 22, -0.5, -6);
    return m;
  };
  scene.add(mkMountain(-1), mkMountain(1));

  // --- light ribbons (flow in with scroll) ---
  const ribbonTime = { value: 0 }, ribbonAlpha = { value: 0 };
  const ribbons = new THREE.Group();
  const paths = [
    [[-26, 0.8, -10], [-12, 2.0, -4], [-2, 0.8, 3], [10, 2.8, -3], [24, 5.5, -14]],
    [[-24, 4.0, -18], [-10, 2.4, -9], [3, 1.0, 0], [14, 2.2, -5], [28, 1.0, -12]],
    [[-22, 0.6, -2], [-12, 1.2, 3], [0, 1.8, 6], [12, 0.8, 2], [26, 2.4, -6]],
    [[-30, 6.5, -26], [-16, 4.0, -16], [0, 3.2, -12], [16, 4.8, -18], [32, 7.5, -28]],
  ].map(pts => pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  paths.forEach((pts, i) => {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.6);
    const geo = new THREE.TubeGeometry(curve, 160, 0.10 + i * 0.02, 8, false);
    const mat = new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader: RIBBON_FRAG, uniforms: { uTime: ribbonTime, uAlpha: ribbonAlpha, uSeed: { value: i * 0.37 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    ribbons.add(new THREE.Mesh(geo, mat));
  });
  scene.add(ribbons);

  // --- motes ---
  const COUNT = 700;
  const pos = new Float32Array(COUNT * 3), seed = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) { pos[i*3] = (Math.random()*2-1)*24; pos[i*3+1] = Math.random()*9; pos[i*3+2] = (Math.random()*2-1)*24; seed[i] = Math.random(); }
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); mg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const moteU = { uTime: { value: 0 }, uPR: { value: renderer.getPixelRatio() } };
  scene.add(new THREE.Points(mg, new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: moteU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));

  // --- post ---
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.55, 0.78);
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

  let raf = 0, running = true; const start = performance.now();
  const frame = (now: number) => {
    if (!running) return;
    const t = reduced ? 0 : (now - start) / 1000;
    lenis?.raf(now);
    mouse.lerp(target, 0.05);
    const p = progress;

    // prism: float and a slow tilt (an oscillation, not a spin, so the beam stays legible), scrubbed by scroll
    prism.position.y = 3.4 + Math.sin(t * 0.6) * 0.15 + p * 1.0;
    prism.rotation.set(0.12 + Math.sin(t * 0.25) * 0.08 + p * 0.45, 0.55 + Math.sin(t * 0.18) * 0.15 + p * 0.2, -0.06 - p * 0.2);
    body.rotation.z = Math.sin(t * 0.2) * 0.12;
    prism.scale.setScalar(1 + p * 0.12);
    (coreGlow.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.02 * Math.sin(t * 1.3);
    const beamOn = 0.9 * (1 - smooth(0.3, 0.62, p));
    beamU.uAlpha.value = beamOn; fanU.uAlpha.value = beamOn;
    prismLight.position.copy(prism.position); prismLight.intensity = 28 + 12 * p + 4 * Math.sin(t * 1.3);

    // ribbons flow in through the middle of the journey
    ribbonAlpha.value = smooth(0.15, 0.5, p) * (1 - 0.35 * smooth(0.8, 1, p));

    camera.position.set(camBase.x + mouse.x * 0.8, camBase.y + mouse.y * 0.4 + p * 0.6, camBase.z - p * 1.2);
    camera.lookAt(0, 2.2 + p * 0.5, 0);

    waterU.uTime.value = t; waterU.uLightPos.value.copy(prism.position); waterU.uCam.value.copy(camera.position);
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
    composer.dispose(); pmrem.dispose(); renderer.dispose();
  };
}
