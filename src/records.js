import * as THREE from 'three';
import { loadArt, pruneArt } from './art.js';
import { pathAt, clamp, damp, lerp, hueColor } from './util.js';

const R = 1.35;       // disc radius
const SLEEVE = 3.0;   // sleeve size
const tmp = new THREE.Vector3();

function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Shared GPU resources: built once, used by every record.
let shared = null;
function getShared() {
  if (shared) return shared;
  const groove = canvasTex(1024, (g, s) => {
    g.fillStyle = '#0b0b10'; g.fillRect(0, 0, s, s);
    for (let r = 188; r < 502; r += 1.5) {
      g.strokeStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.15})`;
      g.lineWidth = 0.8; g.beginPath(); g.arc(s / 2, s / 2, r, 0, Math.PI * 2); g.stroke();
    }
    for (const r of [262, 334, 404, 462]) {
      g.strokeStyle = 'rgba(0,0,0,.85)'; g.lineWidth = 3.5;
      g.beginPath(); g.arc(s / 2, s / 2, r, 0, Math.PI * 2); g.stroke();
    }
  });
  const sheen = canvasTex(512, (g, s) => {
    g.clearRect(0, 0, s, s);
    if (g.createConicGradient) {
      const cg = g.createConicGradient(0.4, s / 2, s / 2);
      cg.addColorStop(0, 'rgba(255,255,255,0)');
      cg.addColorStop(0.05, 'rgba(255,255,255,.55)');
      cg.addColorStop(0.11, 'rgba(255,255,255,0)');
      cg.addColorStop(0.5, 'rgba(255,255,255,0)');
      cg.addColorStop(0.55, 'rgba(255,255,255,.55)');
      cg.addColorStop(0.61, 'rgba(255,255,255,0)');
      cg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = cg; g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
    }
  });
  const discGeo = new THREE.CylinderGeometry(R, R, 0.045, 64, 1);
  discGeo.rotateX(Math.PI / 2); // axis now points at the camera
  const black = new THREE.MeshStandardMaterial({ color: 0x08080b, roughness: 0.45, metalness: 0.1 });
  shared = {
    discGeo,
    sleeveGeo: new THREE.BoxGeometry(SLEEVE, SLEEVE, 0.07),
    labelGeo: new THREE.CircleGeometry(0.47, 48),
    spindleGeo: new THREE.CircleGeometry(0.04, 16),
    sheenGeo: new THREE.CircleGeometry(R, 64),
    rodGeo: new THREE.CylinderGeometry(0.022, 0.022, 1.14, 10),
    headGeo: new THREE.BoxGeometry(0.17, 0.11, 0.07),
    baseGeo: new THREE.CylinderGeometry(0.15, 0.17, 0.09, 24).rotateX(Math.PI / 2),
    cwGeo: new THREE.CylinderGeometry(0.07, 0.07, 0.22, 16),
    discMats: [
      black,
      new THREE.MeshStandardMaterial({ map: groove, roughness: 0.5, metalness: 0.15 }),
      black,
    ],
    dark: new THREE.MeshStandardMaterial({ color: 0x15131c, roughness: 0.75, metalness: 0.1 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xdcdce6, metalness: 0.95, roughness: 0.22 }),
    spindle: new THREE.MeshBasicMaterial({ color: 0x050505 }),
    sheenTex: sheen,
  };
  return shared;
}

class Rec {
  constructor(index, song) {
    const S = getShared();
    this.index = index; this.song = song;
    this.age = 0; this.spin = Math.random() * 6; this.spinV = 0; this.armT = 0; this.reveal = 0;
    this.color = hueColor(song.id);
    this.group = new THREE.Group();

    // Sleeve with the cover on its front face.
    this.front = new THREE.MeshStandardMaterial({ color: 0x1a1822, roughness: 0.5, metalness: 0.05, emissive: 0x000000 });
    const mats = [S.dark, S.dark, S.dark, S.dark, this.front, S.dark];
    this.sleeve = new THREE.Mesh(S.sleeveGeo, mats);
    this.sleeve.userData.index = index;

    // Disc: pivot (slides) > spin group (rotates) > cylinder + label
    this.disc = new THREE.Group();
    this.spinG = new THREE.Group();
    this.discMesh = new THREE.Mesh(S.discGeo, S.discMats);
    this.discMesh.userData.index = index;
    this.labelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
    const label = new THREE.Mesh(S.labelGeo, this.labelMat); label.position.z = 0.024;
    const hole = new THREE.Mesh(S.spindleGeo, S.spindle); hole.position.z = 0.026;
    this.spinG.add(this.discMesh, label, hole);

    // Light sheen stays still while the disc spins under it.
    this.sheenMat = new THREE.MeshBasicMaterial({ map: S.sheenTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const sheen = new THREE.Mesh(S.sheenGeo, this.sheenMat); sheen.position.z = 0.03;

    // Tonearm
    this.arm = new THREE.Group();
    this.arm.position.set(1.45, 1.15, 0.1);
    const rod = new THREE.Mesh(S.rodGeo, S.metal); rod.position.y = -0.57;
    const head = new THREE.Mesh(S.headGeo, S.dark); head.position.y = -1.15;
    const base = new THREE.Mesh(S.baseGeo, S.metal);
    const cw = new THREE.Mesh(S.cwGeo, S.metal); cw.position.y = 0.3;
    this.arm.add(rod, head, base, cw);
    this.disc.add(this.spinG, sheen, this.arm);

    this.group.add(this.disc, this.sleeve);
    this.disc.position.z = -0.05;
    this.group.scale.setScalar(0.001);
  }

  setArt({ tex, color }) {
    this.front.map = tex; this.front.emissiveMap = tex; this.front.emissive.set(0xffffff);
    this.front.color.set(0xffffff); this.front.needsUpdate = true;
    this.labelMat.map = tex; this.labelMat.color.set(0xffffff); this.labelMat.needsUpdate = true;
    this.color.copy(color);
    this.hasArt = true;
  }

  update(pos, t, dt, playing, bass) {
    this.age += dt;
    const d = this.index - pos, ad = Math.abs(d);
    const s = clamp(1 - ad, 0, 1), e = s * s * (3 - 2 * s);
    pathAt(this.index, tmp);
    this.group.position.copy(tmp);
    this.group.position.y += Math.sin(t * 0.8 + this.index * 1.7) * 0.14 * (1 - e);
    this.group.rotation.set(0, -d * 0.3 + Math.sin(t * 0.4 + this.index) * 0.06 * (1 - e), Math.sin(this.index * 2.3) * 0.09 * (1 - e));
    const appear = 1 - Math.exp(-this.age * 2.6);
    this.reveal = damp(this.reveal, this.hasArt ? 1 : 0, 4, dt);
    const sc = lerp(0.78, 1, e) * (1 + (e > 0.85 ? bass * 0.045 : 0)) * appear;
    this.group.scale.setScalar(Math.max(sc, 0.001));

    this.sleeve.position.x = lerp(0, -0.95, e);
    this.disc.position.x = lerp(0.3, 1.2, e);

    const live = e > 0.6 && playing;
    const target = live ? 3.6 + bass * 5.5 : e > 0.6 ? 0 : 0.4;
    this.spinV = damp(this.spinV, target, 3.5, dt);
    this.spin += this.spinV * dt;
    this.spinG.rotation.z = -this.spin;

    this.armT = damp(this.armT, live ? 1 : 0, 2.2, dt);
    this.arm.rotation.z = lerp(0.15, -0.91, this.armT);
    this.arm.visible = e > 0.04;

    this.front.emissiveIntensity = 0.1 * this.reveal;
    this.sheenMat.opacity = 0.4 * e;
  }

  dispose() {
    this.front.dispose(); this.labelMat.dispose(); this.sheenMat.dispose();
  }
}

export class RecordPool {
  constructor(scene) { this.scene = scene; this.map = new Map(); }

  sync(pos, songs) {
    const lo = Math.max(0, Math.floor(pos) - 2);
    const hi = Math.min(songs.length - 1, Math.floor(pos) + 6);
    for (let i = lo; i <= hi; i++) {
      if (this.map.has(i)) continue;
      const rec = new Rec(i, songs[i]);
      this.map.set(i, rec);
      this.scene.add(rec.group);
      loadArt(songs[i]).then((a) => {
        songs[i].color = a.color;
        if (!rec.dead) rec.setArt(a);
      });
    }
    for (const [i, rec] of this.map) {
      if (i < lo || i > hi) this._drop(i, rec);
    }
    const keep = new Set();
    for (const rec of this.map.values()) keep.add(rec.song.id);
    pruneArt(keep);
  }

  _drop(i, rec) { rec.dead = true; this.scene.remove(rec.group); rec.dispose(); this.map.delete(i); }
  clear() { for (const [i, rec] of [...this.map]) this._drop(i, rec); }

  update(pos, t, dt, playing, bass) {
    for (const rec of this.map.values()) rec.update(pos, t, dt, playing, bass);
  }

  pick(raycaster) {
    const meshes = [];
    for (const r of this.map.values()) meshes.push(r.sleeve, r.discMesh);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    return hit ? hit.object.userData.index : -1;
  }
}
