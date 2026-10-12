import * as THREE from 'three';
import { pathAt, clamp, damp, SP } from './util.js';

// Light-weight stage: transparent canvas over a CSS background, no post-processing.
const STAR_VERT = `
attribute float aSize; uniform float uCamZ; uniform float uRange; uniform float uPx; varying float vA;
void main(){
  float dz = mod(position.z - uCamZ + uRange*0.5, uRange) - uRange*0.5;
  vec4 mv = modelViewMatrix*vec4(position.xy, uCamZ+dz, 1.0);
  gl_PointSize = aSize*uPx*(26.0/max(1.0,-mv.z));
  gl_Position = projectionMatrix*mv;
  vA = smoothstep(uRange*0.5, uRange*0.3, abs(dz));
}`;
const STAR_FRAG = `varying float vA; void main(){ float d=length(gl_PointCoord-0.5); gl_FragColor=vec4(1.0,0.96,0.88, smoothstep(0.5,0.1,d)*vA*0.7); }`;
const STREAK_VERT = `
attribute float aEnd; uniform float uCamZ; uniform float uRange; uniform float uStreak; varying float vA;
void main(){
  float dz = mod(position.z - uCamZ + uRange*0.5, uRange) - uRange*0.5;
  vec3 p = vec3(position.xy, uCamZ+dz + aEnd*uStreak);
  gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.0);
  vA = (1.0-aEnd*0.9)*smoothstep(uRange*0.5, uRange*0.3, abs(dz));
}`;
const STREAK_FRAG = `uniform float uAlpha; varying float vA; void main(){ gl_FragColor=vec4(1.0,0.96,0.88, vA*uAlpha); }`;

export function createStage(canvas) {
  let PR = Math.min(window.devicePixelRatio || 1, 1.25);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(PR);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2a2070, 14, 72);
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 200);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7aa8, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(2.5, 3.5, 5); scene.add(key);

  const RANGE = 150;
  const rnd = (a, b) => a + Math.random() * (b - a);

  const NS = 420, sp = new Float32Array(NS * 3), ss = new Float32Array(NS);
  for (let i = 0; i < NS; i++) {
    const ang = Math.random() * Math.PI * 2, r = 4 + Math.pow(Math.random(), 0.7) * 28;
    sp[i * 3] = Math.cos(ang) * r; sp[i * 3 + 1] = Math.sin(ang) * r * 0.7; sp[i * 3 + 2] = Math.random() * RANGE; ss[i] = rnd(0.7, 2.2);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('aSize', new THREE.BufferAttribute(ss, 1));
  const starMat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false,
    uniforms: { uCamZ: { value: 0 }, uRange: { value: RANGE }, uPx: { value: PR } },
  });
  const stars = new THREE.Points(sg, starMat); stars.frustumCulled = false; scene.add(stars);

  const NL = 130, lp = new Float32Array(NL * 6), le = new Float32Array(NL * 2);
  for (let i = 0; i < NL; i++) {
    const ang = Math.random() * Math.PI * 2, r = 3 + Math.pow(Math.random(), 0.8) * 14, z = Math.random() * RANGE;
    const x = Math.cos(ang) * r, y = Math.sin(ang) * r * 0.75;
    lp.set([x, y, z, x, y, z], i * 6); le[i * 2] = 0; le[i * 2 + 1] = 1;
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  lg.setAttribute('aEnd', new THREE.BufferAttribute(le, 1));
  const streakMat = new THREE.ShaderMaterial({
    vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG, transparent: true, depthWrite: false,
    uniforms: { uCamZ: { value: 0 }, uRange: { value: RANGE }, uStreak: { value: 0 }, uAlpha: { value: 0 } },
  });
  const streaks = new THREE.LineSegments(lg, streakMat); streaks.frustumCulled = false; scene.add(streaks);

  const a = new THREE.Vector3(), b = new THREE.Vector3(), look = new THREE.Vector3();
  let sx = 0, sy = 0;

  function update({ pos, vel, time, dt, energy: e, fogColor, homeAmt, mouse }) {
    pathAt(pos, a); pathAt(pos - 0.5, b);
    sx = damp(sx, mouse.x, 3, dt); sy = damp(sy, mouse.y, 3, dt);
    camera.fov = 52 + Math.min(Math.abs(vel) * 4, 12);
    camera.updateProjectionMatrix();
    const tanH = Math.tan((camera.fov * Math.PI) / 360);
    const dist = Math.max(5.5, 6.8 / (2 * tanH * camera.aspect));
    const shift = camera.aspect > 1.1 ? -2.7 * homeAmt : 0; // on the home screen the tunnel sits to the right
    const shake = e.bass * 0.02;
    camera.position.set(a.x + shift + sx * 0.5 + Math.sin(time * 41) * shake, a.y + 0.1 + sy * 0.35, a.z + dist);
    look.set((a.x + b.x) / 2 + shift, (a.y + b.y) / 2, a.z - 1);
    camera.lookAt(look);
    camera.rotateZ((b.x - a.x) * 0.04 - sx * 0.012);

    scene.fog.color.copy(fogColor);
    starMat.uniforms.uCamZ.value = camera.position.z;
    streakMat.uniforms.uCamZ.value = camera.position.z;
    streakMat.uniforms.uStreak.value = vel * 2.4;
    streakMat.uniforms.uAlpha.value = clamp(Math.abs(vel) * 0.4, 0, 0.7);
  }

  function setPixelRatio(v) { PR = v; renderer.setPixelRatio(v); starMat.uniforms.uPx.value = v; renderer.setSize(innerWidth, innerHeight, false); }
  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);

  return { renderer, scene, camera, update, render: () => renderer.render(scene, camera), setPixelRatio, getPR: () => PR };
}
