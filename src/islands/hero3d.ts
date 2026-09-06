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
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
  float sdSeg(vec2 p, vec2 a, vec2 b, float w){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - w; }
  float sdEllipse(vec2 p, vec2 r){ return (length(p / r) - 1.0) * min(r.x, r.y); }
  vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
  // three subjects, morphed by blending their distance fields: butterflies, water plants in a pot, a bicycle
  float butterfly(vec2 p, vec2 c, float sc, float ang){
    vec2 q = rot(p - c, ang) / sc;
    float body = sdSeg(q, vec2(0.0, -0.5), vec2(0.0, 0.45), 0.07);
    float head = length(q - vec2(0.0, 0.52)) - 0.09;
    vec2 m = vec2(abs(q.x), q.y);
    float up = sdEllipse(rot(m - vec2(0.44, 0.20), 0.55), vec2(0.46, 0.32));
    float lo = sdEllipse(rot(m - vec2(0.32, -0.32), -0.35), vec2(0.30, 0.24));
    float ant = min(sdSeg(q, vec2(0.0, 0.55), vec2(-0.22, 0.85), 0.02), sdSeg(q, vec2(0.0, 0.55), vec2(0.22, 0.85), 0.02));
    return min(min(smin(body, head, 0.03), smin(up, lo, 0.06)), ant) * sc;
  }
  float subjectA(vec2 p){
    float d = butterfly(p, vec2(-0.02, 0.10), 0.40, 0.15);
    d = min(d, butterfly(p, vec2(-0.52, 0.66), 0.26, 0.55));
    d = min(d, butterfly(p, vec2(0.50, 0.72), 0.22, -0.65));
    d = min(d, butterfly(p, vec2(-0.55, -0.50), 0.24, -0.95));
    d = min(d, butterfly(p, vec2(0.52, -0.42), 0.28, 0.80));
    d = min(d, butterfly(p, vec2(0.05, -0.92), 0.18, 0.30));
    d = min(d, butterfly(p, vec2(0.62, 0.15), 0.15, 1.3));
    return d;
  }
  float wheel(vec2 p, vec2 c, float r){
    vec2 q = p - c;
    float tyre = abs(length(q) - r) - 0.035;
    float hub = length(q) - 0.05;
    float sp = 1e9;
    for (int i = 0; i < 8; i++) { float a = float(i) * 0.3927; vec2 dir = vec2(cos(a), sin(a)); sp = min(sp, sdSeg(q, -dir * r, dir * r, 0.008)); }
    return min(min(tyre, hub), sp);
  }
  float subjectC(vec2 p){
    vec2 q = (p - vec2(0.0, -0.12)) * 1.3;
    vec2 R = vec2(-0.56, -0.42), F = vec2(0.56, -0.42), B = vec2(0.04, -0.44), S = vec2(-0.16, 0.24), H = vec2(0.40, 0.20);
    float d = min(wheel(q, R, 0.40), wheel(q, F, 0.40));
    float w = 0.03;
    d = min(d, sdSeg(q, R, S, w)); d = min(d, sdSeg(q, R, B, w)); d = min(d, sdSeg(q, B, S, w));
    d = min(d, sdSeg(q, B, H, w)); d = min(d, sdSeg(q, S, H, w)); d = min(d, sdSeg(q, H, F, w));
    d = min(d, sdSeg(q, S, vec2(-0.22, 0.40), 0.025)); d = min(d, sdBox(q - vec2(-0.24, 0.42), vec2(0.15, 0.035), 0.03));
    d = min(d, sdSeg(q, H, vec2(0.46, 0.40), 0.025)); d = min(d, sdBox(q - vec2(0.44, 0.42), vec2(0.17, 0.028), 0.02));
    d = min(d, length(q - B) - 0.07); d = min(d, sdSeg(q, B, B + vec2(0.14, 0.10), 0.02)); d = min(d, sdBox(q - (B + vec2(0.17, 0.10)), vec2(0.06, 0.02), 0.01));
    return d / 1.3;
  }
  float sdCircle(vec2 p, vec2 c, float r){ return length(p - c) - r; }
  // 2 · hope: a dove with a sprig
  float sDove(vec2 p){
    vec2 q = rot(p - vec2(0.02, -0.05), -0.25);
    float body = sdEllipse(q, vec2(0.48, 0.24));
    float head = sdCircle(q, vec2(0.46, 0.16), 0.14);
    float beak = sdEllipse(rot(q - vec2(0.62, 0.15), 0.1), vec2(0.08, 0.03));
    float wingUp = sdEllipse(rot(q - vec2(-0.02, 0.52), 1.15), vec2(0.62, 0.15));
    float wingLo = sdEllipse(rot(q - vec2(0.10, 0.30), 0.85), vec2(0.42, 0.11));
    float tail = min(sdEllipse(rot(q - vec2(-0.60, -0.02), 0.25), vec2(0.28, 0.08)), sdEllipse(rot(q - vec2(-0.58, -0.14), -0.05), vec2(0.28, 0.07)));
    float eye = sdCircle(q, vec2(0.50, 0.19), 0.025);
    // the sprig, held in the beak
    float stem = sdSeg(q, vec2(0.66, 0.10), vec2(0.86, -0.32), 0.014);
    float leaves = min(min(sdEllipse(rot(q - vec2(0.70, -0.06), 0.9), vec2(0.10, 0.04)), sdEllipse(rot(q - vec2(0.82, -0.18), -0.2), vec2(0.10, 0.04))), sdEllipse(rot(q - vec2(0.78, -0.30), 1.1), vec2(0.09, 0.035)));
    float d = smin(smin(body, head, 0.06), min(wingUp, wingLo), 0.05); d = min(d, tail); d = min(d, beak); d = max(d, -eye);
    return min(d, min(stem, leaves));
  }
  // 3 · family: three figures holding hands
  float figure(vec2 p, vec2 c, float h){
    vec2 q = (p - c) / h;                                                 // h: height scale
    float head = sdCircle(q, vec2(0.0, 0.80), 0.17);
    float body = sdBox(q - vec2(0.0, 0.30), vec2(0.17, 0.30), 0.14);
    float legs = min(sdBox(q - vec2(-0.09, -0.32), vec2(0.07, 0.34), 0.06), sdBox(q - vec2(0.09, -0.32), vec2(0.07, 0.34), 0.06));
    return smin(smin(head, body, 0.04), legs, 0.03) * h;
  }
  float sFamily(vec2 p){
    vec2 A = vec2(-0.58, -0.30), B = vec2(0.58, -0.30), C = vec2(0.0, -0.52);
    float d = min(min(figure(p, A, 1.0), figure(p, B, 0.95)), figure(p, C, 0.62));
    // arms: parents reach down to the child, outer arms hang
    float arms = min(sdSeg(p, A + vec2(0.16, 0.48), C + vec2(-0.12, 0.28), 0.045), sdSeg(p, B + vec2(-0.16, 0.46), C + vec2(0.12, 0.28), 0.045));
    arms = min(arms, min(sdSeg(p, A + vec2(-0.16, 0.48), A + vec2(-0.26, 0.05), 0.045), sdSeg(p, B + vec2(0.16, 0.46), B + vec2(0.26, 0.05), 0.045)));
    return smin(d, arms, 0.03);
  }
  // 4 · a cat, sitting
  float sCat(vec2 p){
    float body = sdEllipse(p - vec2(0.0, -0.42), vec2(0.46, 0.62));
    float head = sdCircle(p, vec2(0.06, 0.48), 0.30);
    float ears = min(sdEllipse(rot(p - vec2(-0.14, 0.76), 0.35), vec2(0.08, 0.17)), sdEllipse(rot(p - vec2(0.26, 0.76), -0.35), vec2(0.08, 0.17)));
    float legs = min(sdBox(p - vec2(-0.16, -0.78), vec2(0.09, 0.30), 0.06), sdBox(p - vec2(0.12, -0.78), vec2(0.09, 0.30), 0.06));
    float tail = min(min(sdSeg(p, vec2(0.40, -0.95), vec2(0.70, -0.75), 0.055), sdSeg(p, vec2(0.70, -0.75), vec2(0.78, -0.40), 0.05)), sdSeg(p, vec2(0.78, -0.40), vec2(0.66, -0.12), 0.045));
    float eyes = min(sdEllipse(p - vec2(-0.05, 0.50), vec2(0.045, 0.06)), sdEllipse(p - vec2(0.17, 0.50), vec2(0.045, 0.06)));
    return max(min(min(smin(smin(body, head, 0.08), ears, 0.03), legs), tail), -eyes);
  }
  // 5 · an acoustic guitar
  float sGuitar(vec2 p0){
    vec2 p = p0 * 1.35;
    float body = smin(sdCircle(p, vec2(0.0, -0.60), 0.52), sdCircle(p, vec2(0.0, 0.0), 0.40), 0.15);
    body = max(body, -sdCircle(p, vec2(0.0, -0.28), 0.15));
    float neck = sdBox(p - vec2(0.0, 0.72), vec2(0.075, 0.48), 0.02);
    float head = sdBox(p - vec2(0.0, 1.14), vec2(0.12, 0.13), 0.04);
    float pegs = 1e9; for (int i = 0; i < 3; i++) { float y = 1.04 + float(i) * 0.08; pegs = min(pegs, min(sdCircle(p, vec2(-0.17, y), 0.025), sdCircle(p, vec2(0.17, y), 0.025))); }
    return min(min(min(body, neck), head), pegs) / 1.35;
  }
  // 6 · a bonsai
  float sBonsai(vec2 p){
    float pot = sdBox(p - vec2(0.0, -0.95), vec2(0.55, 0.16), 0.05);
    float trunk = min(min(sdSeg(p, vec2(0.0, -0.80), vec2(-0.12, -0.35), 0.07), sdSeg(p, vec2(-0.12, -0.35), vec2(0.18, 0.05), 0.06)), sdSeg(p, vec2(0.18, 0.05), vec2(-0.05, 0.42), 0.05));
    float br = min(sdSeg(p, vec2(-0.12, -0.35), vec2(-0.55, -0.10), 0.035), sdSeg(p, vec2(0.18, 0.05), vec2(0.62, 0.20), 0.035));
    float can = min(min(sdEllipse(p - vec2(-0.55, 0.05), vec2(0.34, 0.14)), sdEllipse(p - vec2(0.62, 0.36), vec2(0.34, 0.15))), sdEllipse(p - vec2(-0.05, 0.62), vec2(0.42, 0.18)));
    can = min(can, sdEllipse(p - vec2(0.22, 0.22), vec2(0.26, 0.11)));
    return min(min(pot, smin(trunk, br, 0.03)), can);
  }
  // 7 · a hot-air balloon
  float sBalloon(vec2 p){
    float env = smin(sdCircle(p, vec2(0.0, 0.45), 0.60), sdEllipse(p - vec2(0.0, -0.10), vec2(0.30, 0.55)), 0.25);
    float basket = sdBox(p - vec2(0.0, -0.92), vec2(0.19, 0.13), 0.03);
    float ropes = min(sdSeg(p, vec2(-0.17, -0.55), vec2(-0.14, -0.80), 0.012), sdSeg(p, vec2(0.17, -0.55), vec2(0.14, -0.80), 0.012));
    float gores = 1e9; for (int i = 0; i < 3; i++) { float x = -0.30 + float(i) * 0.30; gores = min(gores, abs(sdEllipse(p - vec2(x * 0.5, 0.42), vec2(0.20 + abs(x) * 0.6, 0.62))) - 0.006); }
    return min(min(max(env, -gores), basket), ropes);
  }
  // 8 · a desk lamp
  float sLamp(vec2 p){
    float base = sdEllipse(p - vec2(-0.20, -0.98), vec2(0.42, 0.09));
    float arm = min(sdSeg(p, vec2(-0.20, -0.95), vec2(-0.42, -0.15), 0.035), sdSeg(p, vec2(-0.42, -0.15), vec2(0.22, 0.55), 0.035));
    float joint = min(sdCircle(p, vec2(-0.42, -0.15), 0.07), sdCircle(p, vec2(0.22, 0.55), 0.07));
    float shade = sdBox(rot(p - vec2(0.42, 0.62), -0.75), vec2(0.34, 0.20), 0.05);
    float bulb = sdCircle(p, vec2(0.60, 0.45), 0.08);
    return min(min(min(base, arm), joint), smin(shade, bulb, 0.05));
  }
  // 9 · a koi
  float sKoi(vec2 p){
    vec2 q = rot(p - vec2(0.05, 0.0), 0.55);
    float body = sdEllipse(q, vec2(0.78, 0.30));
    float tail = min(sdEllipse(rot(q - vec2(-0.90, 0.16), 0.5), vec2(0.28, 0.10)), sdEllipse(rot(q - vec2(-0.90, -0.16), -0.5), vec2(0.28, 0.10)));
    float fins = min(sdEllipse(rot(q - vec2(0.05, 0.36), 0.6), vec2(0.18, 0.07)), sdEllipse(rot(q - vec2(0.05, -0.36), -0.6), vec2(0.18, 0.07)));
    float eye = sdCircle(q, vec2(0.52, 0.08), 0.04);
    return max(min(smin(body, tail, 0.06), fins), -eye);
  }
  // 10 · a camera
  float sCamera(vec2 p){
    float body = sdBox(p - vec2(0.0, -0.12), vec2(0.78, 0.44), 0.10);
    float hood = sdBox(p - vec2(-0.25, 0.38), vec2(0.22, 0.10), 0.04);
    float lens = sdCircle(p, vec2(0.08, -0.12), 0.34);
    float ring = abs(sdCircle(p, vec2(0.08, -0.12), 0.24)) - 0.02;
    float glass = sdCircle(p, vec2(0.08, -0.12), 0.14);
    float button = sdBox(p - vec2(0.55, 0.36), vec2(0.07, 0.05), 0.02);
    float d = smin(body, hood, 0.03); d = min(d, lens); d = max(d, -ring); d = max(d, -glass); d = min(d, button);
    return d;
  }
  float sdBy(int i, vec2 p){
    if (i == 0) return subjectA(p); if (i == 1) return subjectC(p); if (i == 2) return sDove(p); if (i == 3) return sFamily(p);
    if (i == 4) return sCat(p); if (i == 5) return sGuitar(p); if (i == 6) return sBonsai(p); if (i == 7) return sBalloon(p);
    if (i == 8) return sLamp(p); if (i == 9) return sKoi(p); return sCamera(p);
  }
  uniform int uA; uniform int uB; uniform float uF;
  float subject(vec2 p){ return mix(sdBy(uA, p), sdBy(uB, p), uF); }
  // the photo behind the subject: a soft landscape that keeps changing — clouds morph, bokeh drifts in and fades out
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  float fbm2(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * n2(p); p = p * 2.03 + 7.1; a *= 0.5; } return v; }
  vec3 scenePhoto(vec2 p, float t){
    float sky = smoothstep(-1.3, 1.2, p.y);
    vec3 col = mix(vec3(0.07, 0.14, 0.30), vec3(0.26, 0.42, 0.74), sky);
    // sun, low on the right, breathing
    float sun = exp(-length(p - vec2(0.55, 0.35)) * 2.2) * (0.5 + 0.1 * sin(t * 0.4));
    col += vec3(0.60, 0.74, 1.0) * sun;
    // clouds: two layers of moving noise that morph into each other
    float c1 = fbm2(p * 1.6 + vec2(t * 0.02, 0.0) + 3.0);
    float c2 = fbm2(p * 2.4 - vec2(t * 0.015, t * 0.008) + 11.0);
    float cloud = smoothstep(0.45, 0.75, mix(c1, c2, 0.5 + 0.5 * sin(t * 0.13))) * smoothstep(-0.3, 0.6, p.y);
    col = mix(col, vec3(0.55, 0.68, 0.95), cloud * 0.35);
    // hills: layered ridges with a hairline of light on each crest
    float r1 = -0.45 + 0.10 * sin(p.x * 2.1 + 0.4) + 0.05 * sin(p.x * 5.3);
    float r2 = -0.75 + 0.08 * sin(p.x * 1.6 + 2.0) + 0.04 * sin(p.x * 4.1 + 1.0);
    col = mix(col, vec3(0.06, 0.12, 0.26), smoothstep(r1 + 0.01, r1 - 0.01, p.y) * 0.6);
    col += vec3(0.5, 0.7, 1.0) * smoothstep(0.02, 0.0, abs(p.y - r1)) * 0.18;
    col = mix(col, vec3(0.04, 0.09, 0.20), smoothstep(r2 + 0.01, r2 - 0.01, p.y) * 0.7);
    col += vec3(0.5, 0.7, 1.0) * smoothstep(0.02, 0.0, abs(p.y - r2)) * 0.12;
    // bokeh: soft discs that drift up and fade in and out on their own clocks
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float life = fract(t * 0.05 + fi * 0.173);                  // 0..1 over ~20s, staggered
      float fade = sin(life * 3.1416);                             // in, then out
      vec2 c = vec2(sin(fi * 2.7) * 0.8, -1.0 + life * 2.2 + sin(fi * 1.3) * 0.2);
      float r = 0.08 + 0.06 * hash(vec2(fi, 1.0));
      col += vec3(0.55, 0.72, 1.0) * smoothstep(r, r * 0.4, length(p - c)) * fade * 0.16;
    }
    return col;
  }
  float card(vec2 p){ return sdBox(p, vec2(1.0, 1.25), 0.10); }
`;
const CARD_VERT = /* glsl */ `
  varying vec2 vP; varying vec3 vW; varying vec3 vN;
  void main(){ vP = (uv - 0.5) * vec2(2.0, 2.5); vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
`;
/** The card: translucent photo-like surface with the subject cut out. */
const CARD_FRAG = /* glsl */ `
  uniform float uTime; uniform vec3 uCam; uniform float uOpen; uniform float uFade;
  varying vec2 vP; varying vec3 vW; varying vec3 vN;
  ${FIELD}
  void main(){
    float dc = card(vP);
    if (dc > 0.0) discard;
    float ds = subject(vP);
    vec3 V = normalize(uCam - vW); vec3 N = normalize(vN); if (dot(N, V) < 0.0) N = -N;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    // the "photo": soft light gradients so it reads as an image, not a slab
    vec3 photo = scenePhoto(vP, uTime);
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
    gl_FragColor = vec4(col, a * uFade);
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
    vec3 photo = scenePhoto(vP, uTime);
    photo += (hash(floor(vP * 90.0)) - 0.5) * 0.05;
    // lifted: the subject carries the light — brighter, cooler, a soft inner glow
    float core = exp(-length(vP - vec2(0.0, 0.1)) * 1.1);
    float sheen = pow(0.5 + 0.5 * sin((vP.x * 0.9 + vP.y * 0.6) * 2.2 - uTime * 0.45 + 1.0), 16.0) * 0.3;
    vec3 col = photo * 0.55 + vec3(0.7, 0.84, 1.0) * (core * 0.26 + sheen);
    float rim = smoothstep(0.05, 0.0, abs(ds));
    col += vec3(0.85, 0.92, 1.0) * rim * 0.32;
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

export type HeroVariant = 'hero' | 'valley' | 'cloudsea' | 'night' | 'aurora' | 'still' | 'prism';
export interface HeroOptions { scrollEl?: HTMLElement; ambient?: boolean; variant?: HeroVariant }
/** Per-page dressing for ambient mode: which cut-out (if any) sits at the side, how strong the ribbons are. */
const VARIANTS: Record<HeroVariant, { card: boolean; subject: number; ribbons: number; haze: number; motes: number }> = {
  hero: { card: true, subject: 0, ribbons: 1.0, haze: 0.22, motes: 1.0 },
  valley: { card: true, subject: 0, ribbons: 0.7, haze: 0.20, motes: 1.0 },   // app home
  cloudsea: { card: false, subject: 2, ribbons: 0.35, haze: 0.14, motes: 0.6 },  // batch workspace: quiet
  night: { card: false, subject: 4, ribbons: 0.5, haze: 0.16, motes: 0.8 },   // batches list
  aurora: { card: true, subject: 6, ribbons: 1.0, haze: 0.24, motes: 1.0 },   // light
  still: { card: false, subject: 3, ribbons: 0.3, haze: 0.12, motes: 0.5 },   // settings
  prism: { card: true, subject: 10, ribbons: 0.8, haze: 0.22, motes: 1.0 },   // pricing
};

export function mountHero(canvas: HTMLCanvasElement, opts: HeroOptions = {}) {
  const ambient = !!opts.ambient;
  const V = VARIANTS[opts.variant ?? 'hero'];
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
  const cardU = { uTime: { value: 0 }, uCam: { value: camera.position.clone() }, uOpen: { value: 1 }, uFade: { value: 1 }, uA: { value: V.subject }, uB: { value: V.subject }, uF: { value: 0 } };
  const plane = new THREE.PlaneGeometry(CW, CH);
  const card = new THREE.Mesh(plane, new THREE.ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: CARD_FRAG, uniforms: cardU, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  const piece = new THREE.Mesh(plane, new THREE.ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: PIECE_FRAG, uniforms: cardU, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  const pieceGlow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.0), additive(GLOW_FRAG, { uAlpha: { value: 0.2 }, uCol: { value: new THREE.Color(0.45, 0.68, 1.0) } }));
  const rig = new THREE.Group();          // the whole composition floats and tilts together
  rig.add(card, piece, pieceGlow);
  rig.position.set(-0.35, 2.35, 0);
  if (ambient) { rig.position.set(4.1, 1.4, -1.8); rig.scale.setScalar(0.8); rig.visible = V.card; }
  scene.add(rig);

  // "keep": the photo stays whole and the work happens here — a stack of photos superimposed in depth
  const STACK = 4;
  const stack = [...Array(STACK)].map((_, i) => {
    const u = { uTime: cardU.uTime, uCam: cardU.uCam, uOpen: { value: 0 }, uFade: { value: 0 }, uA: { value: [9, 6, 3, 10][i] }, uB: { value: [9, 6, 3, 10][i] }, uF: { value: 0 } };
    const m = new THREE.Mesh(plane, new THREE.ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: CARD_FRAG, uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = -1 - i; rig.add(m); return { m, u };
  });
  // "light": abundance — a fan of cut-outs, one of each subject, rising out of the card
  const FAN = 5;
  const fan = [...Array(FAN)].map((_, i) => {
    const u = { uTime: cardU.uTime, uCam: cardU.uCam, uOpen: { value: 0 }, uA: { value: [2, 0, 5, 9, 7][i] }, uB: { value: [2, 0, 5, 9, 7][i] }, uF: { value: 0 } };
    const m = new THREE.Mesh(plane, new THREE.ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: PIECE_FRAG, uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.scale.setScalar(0.55); rig.add(m); return { m, u };
  });

  // --- void dressing: haze behind, a pool of light below ---
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), additive(GLOW_FRAG, { uAlpha: { value: V.haze }, uCol: { value: new THREE.Color(0.18, 0.40, 0.95) } }));
  haze.position.set(ambient ? 2.5 : 0.5, 1.2, -4);
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
  const COUNT = Math.round(500 * V.motes);
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
  const lenis = reduced || ambient ? null : new Lenis({ lerp: 0.08, smoothWheel: true });
  // the three beats are anchors at 0 / ½ / 1 of the journey; each shape is fully formed there, and the scroll settles onto them
  const snap = lenis ? new Snap(lenis, { type: 'proximity', duration: 1.1 }) : null;
  let unsnap: (() => void)[] = [];
  const setSnaps = () => { unsnap.forEach(f => f()); unsnap = []; if (!snap) return; const max = scrollEl.scrollHeight - innerHeight; unsnap = [0, 0.5, 1].map(f => snap.add(Math.round(max * f))); };
  let progress = 0;
  const scrollEl = opts.scrollEl ?? document.documentElement;
  const readScroll = () => { const max = scrollEl.scrollHeight - innerHeight; progress = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0; };
  if (!ambient) { addEventListener('scroll', readScroll, { passive: true }); readScroll(); setSnaps(); addEventListener('resize', setSnaps); }
  const mouse = new THREE.Vector2(), target = new THREE.Vector2();
  const onMove = (e: PointerEvent) => target.set((e.clientX/innerWidth)*2-1, -((e.clientY/innerHeight)*2-1));
  if (!reduced) addEventListener('pointermove', onMove, { passive: true });
  const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  let mS1 = 0, mF = 0, dw2 = 0, dw3 = 0, last = 0, lastIdx = -1;
  const pinned = Number(new URLSearchParams(location.search).get('subject') ?? -1); // ?subject=n pins one of the eleven (for review)
  let raf = 0, running = true; const start = performance.now();
  const frame = (now: number) => {
    if (!running) return;
    const t = reduced ? 0 : (now - start) / 1000;
    lenis?.raf(now);
    mouse.lerp(target, 0.05);
    const p = ambient ? 0 : progress;

    // the composition floats; scroll turns it and lifts the piece further out of the card
    rig.position.y = (ambient ? 1.4 : 2.3) + Math.sin(t * 0.5) * 0.06 + p * 0.05 - (ambient ? 0 : smooth(0.6, 0.85, p) * 0.35);
    rig.rotation.set(0.04 + Math.sin(t * 0.22) * 0.03 + mouse.y * 0.05, (ambient ? -0.55 : -0.32) + Math.sin(t * 0.16) * 0.05 + p * 0.55 + mouse.x * 0.08, 0.02 + Math.sin(t * 0.19) * 0.02);
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 0.016); last = now;
    const k = 1 - Math.exp(-dt * 5.5);
    mS1 += (p - mS1) * k;
    // three beats: lift (rotating subjects) → keep (the pull) → light (abundance). Weights are damped so the handover is never abrupt.
    const tw2 = smooth(0.08, 0.45, p) * (1 - smooth(0.55, 0.92, p)), tw3 = smooth(0.55, 0.92, p);
    const kw = 1 - Math.exp(-dt * 3.2);
    dw2 += (tw2 - dw2) * kw; dw3 += (tw3 - dw3) * kw;
    const w2 = dw2, w3 = dw3;
    // the subject rotates through all eleven on its own clock, morphing from one to the next
    if (!ambient && pinned >= 0) { cardU.uA.value = pinned; cardU.uB.value = pinned; cardU.uF.value = 0; }
    else if (!ambient) {
      const HOLD = 5.0, MORPH = 1.6, N = 11, T = HOLD + MORPH;
      const idx = Math.floor(t / T) % N, ph = t % T;
      if (idx !== lastIdx) { lastIdx = idx; mF = 0; }
      const target = ph < HOLD ? 0 : smooth(0, 1, (ph - HOLD) / MORPH);
      mF += (target - mF) * k;
      cardU.uA.value = idx; cardU.uB.value = (idx + 1) % N; cardU.uF.value = mF;
    }
    // keep: the card fades out and the pull takes over; light: the piece gives way to the fan
    const open = 1 - smooth(0, 0.6, Math.max(w2, w3));
    cardU.uOpen.value = open;
    cardU.uFade.value = 1;
    const lift = (0.35 + mS1 * 0.5) * open;
    piece.position.set(0.7 + lift * 1.1 + Math.sin(t * 0.37) * 0.05, 0.1 + lift * 0.12 + Math.sin(t * 0.5 + 1.2) * 0.05, 0.4 + lift * 0.7 + Math.cos(t * 0.3) * 0.04);
    piece.rotation.set(Math.sin(t * 0.3) * 0.04 - lift * 0.05, 0.08 + lift * 0.12 + Math.sin(t * 0.22) * 0.04, -0.03 + Math.sin(t * 0.26) * 0.03);
    pieceGlow.position.copy(piece.position).add(new THREE.Vector3(0, 0, -0.05)); pieceGlow.rotation.copy(piece.rotation);
    (pieceGlow.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.2 * open;
    // the stack: photos fan out behind the card in depth
    stack.forEach(({ m, u }, i) => {
      const e = smooth(0, 1, Math.min(1, w2 * 1.3 - i * 0.08)), n = i + 1;
      m.position.set(-0.22 * n * e, 0.16 * n * e, -0.32 * n * e);
      m.rotation.set(0, -0.06 * n * e, 0.03 * n * e);
      u.uFade.value = e * (0.85 - i * 0.14);
    });
    // the fan: cut-outs rise out of the card and spread like a hand of cards
    fan.forEach(({ m, u }, i) => {
      const s = (i - (FAN - 1) / 2) / ((FAN - 1) / 2);            // −1 … 1
      const e = smooth(0, 1, Math.min(1, Math.max(0, w3 * 1.6 - Math.abs(s) * 0.3)));
      m.position.set(s * 2.2 * e, 0.1 + e * (0.85 - Math.abs(s) * 0.55) + Math.sin(t * 0.5 + i) * 0.04, 0.6 + e * 0.5 + i * 0.02);
      m.rotation.set(0, 0, -s * 0.28 * e);
      u.uOpen.value = e;
    });
    cardU.uTime.value = t; cardU.uCam.value.copy(camera.position);

    ribbonAlpha.value = ambient ? V.ribbons * 0.7 : 0.75 - 0.45 * w2 + 0.25 * w3;

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
