/**
 * measure-bunny-head.mjs
 * ============================================================
 * Diagnóstico de GEOMETRÍA del modelo Bunny_full.fbx:
 *   1. Bounding box global del grupo (tras centrar en origen).
 *   2. Posición del hueso "head" (ancla natural para decoraciones).
 *   3. Bounding boxes de cada malla (para ubicar el cráneo real).
 *
 * Esto define el HEAD_ANCHOR correcto para las decoraciones 3D
 * (sin adivinar constantes): medidas reales, "sin parches".
 *
 * Run: node scripts/measure-bunny-head.mjs
 * ============================================================
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// --- Shim DOM mínimo (idéntico al fbxDomShim de la app) ---
if (!globalThis.document) {
  const fakeImage = () => {
    const el = {
      tagName: 'IMG',
      style: {},
      complete: false,
      width: 0,
      height: 0,
      naturalWidth: 0,
      naturalHeight: 0,
      crossOrigin: '',
      _listeners: {},
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k]; },
      addEventListener(type, cb) {
        (this._listeners[type] = this._listeners[type] || []).push(cb);
      },
      removeEventListener(type, cb) {
        const arr = this._listeners[type] || [];
        const i = arr.indexOf(cb);
        if (i >= 0) arr.splice(i, 1);
      },
      dispatchEvent() { return true; },
    };
    Object.defineProperty(el, 'src', {
      set(v) { this._src = v; },
      get() { return this._src || ''; },
    });
    return el;
  };
  globalThis.document = {
    createElement() { return fakeImage(); },
    createElementNS() { return fakeImage(); },
    createCanvas() { return fakeImage(); },
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL = join(__dirname, '..', 'public', 'models', 'Bunny_full.fbx');

const buffer = readFileSync(MODEL);
const bufferCopy = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const group = new FBXLoader().parse(bufferCopy, '/models/Bunny_full.fbx');

// Normalizar igual que BunnyModel: escala a 2/maxDim y centrar en origen.
const box = new THREE.Box3().setFromObject(group);
const size = new THREE.Vector3();
box.getSize(size);
const maxDim = Math.max(size.x, size.y, size.z);
const scale = 2 / maxDim;
const center = new THREE.Vector3();
box.getCenter(center);

const v = (x, y, z) => `${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}`;

console.log('=== BOUNDING BOX (sin normalizar) ===');
console.log('  min:', v(box.min.x, box.min.y, box.min.z));
console.log('  max:', v(box.max.x, box.max.y, box.max.z));
console.log('  size:', v(size.x, size.y, size.z));
console.log('  maxDim:', maxDim.toFixed(3), '→ scale =', scale.toFixed(4));
console.log('  center:', v(center.x, center.y, center.z));

// Normalizar (clonar para no mutar el parseado original es innecesario aquí).
group.scale.setScalar(scale);
group.position.sub(center.multiplyScalar(scale));
group.updateMatrixWorld(true);

const nbox = new THREE.Box3().setFromObject(group);
const nsize = new THREE.Vector3();
nbox.getSize(nsize);
const ncenter = new THREE.Vector3();
nbox.getCenter(ncenter);
console.log('');
console.log('=== BOUNDING BOX (normalizada: 2/maxDim, centrada) ===');
console.log('  min:', v(nbox.min.x, nbox.min.y, nbox.min.z));
console.log('  max:', v(nbox.max.x, nbox.max.y, nbox.max.z));
console.log('  size:', v(nsize.x, nsize.y, nsize.z));
console.log('  center:', v(ncenter.x, ncenter.y, ncenter.z));

console.log('');
console.log('=== HUESOS RELEVANTES (nombre → world pos normalizada) ===');
group.updateWorldMatrix(true, true);
group.traverse((obj) => {
  if (obj.isBone) {
    const p = new THREE.Vector3();
    obj.getWorldPosition(p);
    if (/head|neck|ear|skull/i.test(obj.name)) {
      console.log(`  ${obj.name}: ${v(p.x, p.y, p.z)}`);
    }
  }
});

console.log('');
console.log('=== MALLAS: nombre → bbox local (frame del modelo normalizado) ===');
group.traverse((obj) => {
  if (obj.isMesh) {
    const b = new THREE.Box3().setFromObject(obj);
    const s = new THREE.Vector3();
    b.getSize(s);
    console.log(`  ${obj.name || '(sin nombre)'}`);
    console.log(`      min=${v(b.min.x, b.min.y, b.min.z)} max=${v(b.max.x, b.max.y, b.max.z)} size=${v(s.x, s.y, s.z)}`);
  }
});
