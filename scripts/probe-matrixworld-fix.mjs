/**
 * Sonda definitiva: confirma que ObjectLoader.parse NO computa matrixWorld
 * (path B) y que updateMatrixWorld(true) lo restaura, haciendo que el
 * Box3.setFromObject del scale block de BunnyViewer mida lo mismo que A.
 *
 * Uso: node scripts/probe-matrixworld-fix.mjs [path.fbx]
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

if (!globalThis.self) globalThis.self = globalThis;
if (!globalThis.document) {
  const fakeImage = () => {
    const el = {
      tagName: 'IMG', style: {}, complete: false, width: 0, height: 0,
      naturalWidth: 0, naturalHeight: 0, crossOrigin: '', _listeners: {},
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k]; },
      addEventListener(type, cb) { (this._listeners[type] = this._listeners[type] || []).push(cb); },
      removeEventListener(type, cb) {
        const arr = this._listeners[type] || [];
        const i = arr.indexOf(cb);
        if (i >= 0) arr.splice(i, 1);
      },
      dispatchEvent() { return true; },
    };
    Object.defineProperty(el, 'src', { set(v) { this._src = v; }, get() { return this._src || ''; } });
    return el;
  };
  globalThis.document = {
    createElement: () => fakeImage(),
    createElementNS: () => fakeImage(),
    createCanvas: () => fakeImage(),
  };
}

const modelArg = process.argv[2] || 'public/models/Bunny_full.fbx';
const modelPath = path.resolve(modelArg);
const buffer = readFileSync(modelPath);

// Ruta A: directo (funcionaba)
const rootA = new FBXLoader().parse(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  modelPath
);
const json = rootA.toJSON();

const boxMax = (root) => {
  const s = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  return { max: Math.max(s.x, s.y, s.z), size: s.toArray().map((x) => x.toFixed(2)) };
};
const mesh0 = (root) => { let m = null; root.traverse((c) => { if (c.isSkinnedMesh && !m) m = c; }); return m; };
// matrixWorld "stale" del primer mesh y de un hueso, antes/después
const bone0 = (root) => { let b = null; root.traverse((c) => { if (c.isBone && !b) b = c; }); return b; };

console.log('=== A directo (parse) ===');
console.log('  Box3.setFromObject:', JSON.stringify(boxMax(rootA)));
const mA = mesh0(rootA);
console.log('  mesh.matrixWorld[12..14] =', mA.matrixWorld.elements.slice(12, 15).map((x) => x.toFixed(3)).join(','), ' | bone.matrixWorld[12..14] =', bone0(rootA).matrixWorld.elements.slice(12, 15).map((x) => x.toFixed(3)).join(','));

// B1: fresco (tal cual lo devuelve ObjectLoader.parse, como hace el worker)
const B1 = new THREE.ObjectLoader().parse(json);
console.log('\n=== B1 fresco (ObjectLoader.parse, sin update) ===');
console.log('  Box3.setFromObject:', JSON.stringify(boxMax(B1)), ' <-- 67.17 = el bug (Flu gigante)');
const mB1 = mesh0(B1);
console.log('  mesh.matrixWorld[12..14] =', mB1.matrixWorld.elements.slice(12, 15).map((x) => x.toFixed(3)).join(','), ' | bone.matrixWorld[12..14] =', bone0(B1).matrixWorld.elements.slice(12, 15).map((x) => x.toFixed(3)).join(','));

// B2: fresco + updateMatrixWorld(true)  <-- el fix candidato
const B2 = new THREE.ObjectLoader().parse(json);
B2.updateMatrixWorld(true);
console.log('\n=== B2 fresco + updateMatrixWorld(true) (fix candidato) ===');
console.log('  Box3.setFromObject:', JSON.stringify(boxMax(B2)), ' <-- debe ser 203.27, igual que A');
const mB2 = mesh0(B2);
console.log('  mesh.matrixWorld[12..14] =', mB2.matrixWorld.elements.slice(12, 15).map((x) => x.toFixed(3)).join(','), ' | bone.matrixWorld[12..14] =', bone0(B2).matrixWorld.elements.slice(12, 15).map((x) => x.toFixed(3)).join(','));
