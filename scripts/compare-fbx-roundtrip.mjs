/**
 * Diagnóstico decisivo: ruta A (FBXLoader.parse directo, funcionaba) vs
 * ruta B (worker: group.toJSON() -> ObjectLoader.parse, produce Flu gigante).
 *
 * Responde 3 preguntas:
 *   1) ¿Qué matrices de huesos difieren entre A y B (local/world) y cuánto?
 *   2) ¿Qué matrixWorld / geometría difieren por malla (caja bind pose)?
 *   3) Tras replicar el pipeline real de BunnyViewer (unifySkeletons + escala),
 *      ¿qué tamaño RENDERIZADO final produce cada ruta?
 *
 * Uso: node scripts/compare-fbx-roundtrip.mjs [path.fbx]
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ---- Shim mínimo de DOM (igual que fbxDomShim.ts, para node) ----
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

// ---------- Ruta A: parse directo (la que funcionaba) ----------
const rootA = new FBXLoader().parse(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  modelPath
);

// ---------- Ruta B: worker -> toJSON -> ObjectLoader.parse ----------
// Replica el flujo REAL de loadFbx tras el fix: updateMatrixWorld(true) para
// restaurar matrixWorld (ObjectLoader.parse lo deja como identidad y eso hacía
// que Box3.setFromObject midiera la caja 3x más pequeña -> Flu gigante).
const json = rootA.toJSON();
const rootB = new THREE.ObjectLoader().parse(json);
rootB.updateMatrixWorld(true);

const mat4 = (m) => m.elements.slice(0, 16).map((x) => Number(x.toFixed(5)));

// ------------------------------------------------------------------
// 1) DIFERENCIA DE HUESOS: agrupar por nombre (primera ocurrencia) y
//    comparar matrices locales y del mundo entre A y B.
// ------------------------------------------------------------------
function collectBones(root) {
  const map = new Map();
  root.traverse((c) => {
    if (!c.isBone) return;
    const name = c.name || '(sin nombre)';
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(c);
  });
  return map;
}
const bonesA = collectBones(rootA);
const bonesB = collectBones(rootB);

console.log('=== 1) DIFERENCIA DE MATRICES DE HUESOS (por nombre, 1a ocurrencia) ===');
const allNames = new Set([...bonesA.keys(), ...bonesB.keys()]);
let localDiffs = 0, worldDiffs = 0, biggestLocal = 0, biggestWorld = 0;
let biggestLocalName = null, biggestWorldName = null;
const localDiffExamples = [];
for (const name of allNames) {
  const a = bonesA.get(name)?.[0];
  const b = bonesB.get(name)?.[0];
  if (!a || !b) { console.log(`  [${name}] solo en ${a ? 'A' : 'B'}`); continue; }
  const la = mat4(a.matrix), lb = mat4(b.matrix);
  const wa = mat4(a.matrixWorld), wb = mat4(b.matrixWorld);
  let maxL = 0, maxW = 0;
  for (let i = 0; i < 16; i++) {
    maxL = Math.max(maxL, Math.abs(la[i] - lb[i]));
    maxW = Math.max(maxW, Math.abs(wa[i] - wb[i]));
  }
  if (maxL > 1e-4) {
    localDiffs++;
    if (maxL > biggestLocal) { biggestLocal = maxL; biggestLocalName = name; }
    if (localDiffExamples.length < 5) {
      localDiffExamples.push(`[${name}] local maxDiff=${maxL.toFixed(5)}\n    A=${la.join(' ')}\n    B=${lb.join(' ')}`);
    }
  }
  if (maxW > 1e-4) {
    worldDiffs++;
    if (maxW > biggestWorld) { biggestWorld = maxW; biggestWorldName = name; }
  }
}
console.log(`  huesos en A: ${[...bonesA.keys()].length}, en B: ${[...bonesB.keys()].length}`);
console.log(`  local diffs: ${localDiffs}, world diffs: ${worldDiffs}`);
console.log(`  mayor diff local: ${biggestLocalName} = ${biggestLocal.toFixed(5)}`);
console.log(`  mayor diff world: ${biggestWorldName} = ${biggestWorld.toFixed(5)}`);
for (const ex of localDiffExamples) console.log(`  ${ex}`);

// ------------------------------------------------------------------
// 2) POR MALLA: geometría bruta + matrixWorld + matriz local
// ------------------------------------------------------------------
function collectMeshes(root) {
  const out = [];
  root.traverse((c) => { if (c.isSkinnedMesh) out.push(c); });
  return out;
}
const meshesA = collectMeshes(rootA);
const meshesB = collectMeshes(rootB);

console.log('\n=== 2) MALLA POR MALLA ===');
for (let i = 0; i < Math.max(meshesA.length, meshesB.length); i++) {
  const a = meshesA[i], b = meshesB[i];
  const name = (a || b).name;
  if (!a || !b) { console.log(`  [${name}] solo en ${a ? 'A' : 'B'}`); continue; }
  // geometría bruta
  a.geometry.computeBoundingBox();
  b.geometry.computeBoundingBox();
  const gA = a.geometry.boundingBox.getSize(new THREE.Vector3());
  const gB = b.geometry.boundingBox.getSize(new THREE.Vector3());
  const geoEq = gA.distanceTo(gB) < 1e-3;
  // matrixWorld de la malla (sin actualizar: lo que ve Box3.setFromObject)
  const wA = mat4(a.matrixWorld), wB = mat4(b.matrixWorld);
  let maxW = 0;
  for (let k = 0; k < 16; k++) maxW = Math.max(maxW, Math.abs(wA[k] - wB[k]));
  console.log(`  [${name}] geo A=${gA.toArray().map((v) => v.toFixed(2)).join(',')} B=${gB.toArray().map((v) => v.toFixed(2)).join(',')} ${geoEq ? 'IGUAL' : 'DIFF'}`);
  if (maxW > 1e-3) {
    console.log(`     matrixWorld DIFF max=${maxW.toFixed(5)}`);
    console.log(`       A=${wA.join(' ')}`);
    console.log(`       B=${wB.join(' ')}`);
  } else {
    console.log(`     matrixWorld IGUAL (${wA[12].toFixed(2)},${wA[13].toFixed(2)},${wA[14].toFixed(2)})`);
  }
  // cadena de padres
  const chain = (o) => {
    const parts = [];
    let cur = o;
    while (cur) { parts.push(`${cur.type}(${cur.name || '?'})`); cur = cur.parent; }
    return parts.join(' <- ');
  };
  console.log(`     A cadena: ${chain(a)}`);
  console.log(`     B cadena: ${chain(b)}`);
}

// ------------------------------------------------------------------
// 2.5) REPLICAR Box3.setFromObject (expandByObject) objeto por objeto.
//      Mismo orden de recursión que three (padre antes que hijos) y
//      updateWorldMatrix(false,false), para ver EXACTAMENTE la caja que
//      aporta cada objeto y su matrixWorld tal como la ve el scale block.
// ------------------------------------------------------------------
function replicateExpandByObject(root) {
  const union = new THREE.Box3();
  const rows = [];
  const visit = (obj) => {
    obj.updateWorldMatrix(false, false);
    if (obj.geometry) {
      if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      if (obj.geometry.boundingBox) {
        const bb = obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld);
        union.union(bb);
        const s = bb.getSize(new THREE.Vector3());
        rows.push({
          name: obj.name || obj.type,
          type: obj.type,
          size: s.toArray().map((x) => x.toFixed(2)),
          maxDim: Math.max(s.x, s.y, s.z),
          mw: obj.matrixWorld.elements.slice(0, 16).map((x) => Number(x.toFixed(3))),
        });
      }
    }
    for (const ch of obj.children) visit(ch);
  };
  visit(root);
  const size = union.getSize(new THREE.Vector3());
  return { maxDim: Math.max(size.x, size.y, size.z), size: size.toArray().map((x) => x.toFixed(2)), rows };
}

console.log('\n=== 2.5) REPLICA DE Box3.setFromObject (expandByObject) por objeto ===');
const repA = replicateExpandByObject(rootA);
const repB = replicateExpandByObject(rootB);
console.log(`  UNION A: maxDim=${repA.maxDim.toFixed(2)} size=[${repA.size}]`);
console.log(`  UNION B: maxDim=${repB.maxDim.toFixed(2)} size=[${repB.size}]`);
// Comparar por (type|name) en el mismo índice de aparición
const key = (r) => `${r.type}|${r.name}`;
const keyA = repA.rows.map(key);
const keyB = repB.rows.map(key);
let printed = 0;
for (let i = 0; i < Math.max(repA.rows.length, repB.rows.length); i++) {
  const a = repA.rows[i], b = repB.rows[i];
  if (!a || !b) { console.log(`  [${(a || b).name}] solo en ${a ? 'A' : 'B'}`); continue; }
  const sizeDiff = a.size.join(',') !== b.size.join(',');
  const mwDiff = a.mw.join(',') !== b.mw.join(',');
  if (sizeDiff || mwDiff) {
    console.log(`  [${a.type}(${a.name})] caja A=[${a.size}] B=[${b.size}] ${sizeDiff ? 'DIFF' : 'IGUAL'} matrixWorld ${mwDiff ? 'DIFF' : 'IGUAL'}`);
    if (mwDiff) {
      console.log(`     A.mw=${a.mw.join(' ')}`);
      console.log(`     B.mw=${b.mw.join(' ')}`);
    }
    printed++;
    if (printed >= 12) { console.log('  ... (más objetos difieren)'); break; }
  }
}
if (printed === 0) console.log('  Ningún objeto aporta caja/matrixWorld distinta (solo difiere la UNION)');

// ------------------------------------------------------------------
// 3) PIPELINE REAL DE BunnyViewer: unifySkeletons + escala + medida final
// ------------------------------------------------------------------
function skinnedBox(root) {
  const mesh = (() => { let m = null; root.traverse((c) => { if (c.isSkinnedMesh && !m) m = c; }); return m; })();
  if (!mesh || !mesh.skeleton) return null;
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const pos = mesh.geometry.attributes.position;
  const skinIndex = mesh.geometry.attributes.skinIndex;
  const skinWeight = mesh.geometry.attributes.skinWeight;
  if (!skinIndex || !skinWeight) return null;
  const bm = mesh.skeleton.boneMatrices;
  const v = new THREE.Vector4();
  const box = new THREE.Box3();
  const v3 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i), 1);
    let ax = 0, ay = 0, az = 0, aw = 0;
    for (let k = 0; k < 4; k++) {
      const idx = skinIndex.getComponent(i, k);
      const w = skinWeight.getComponent(i, k);
      if (w === 0) continue;
      const mIdx = idx * 16;
      ax += (bm[mIdx] * v.x + bm[mIdx + 4] * v.y + bm[mIdx + 8] * v.z + bm[mIdx + 12] * v.w) * w;
      ay += (bm[mIdx + 1] * v.x + bm[mIdx + 5] * v.y + bm[mIdx + 9] * v.z + bm[mIdx + 13] * v.w) * w;
      az += (bm[mIdx + 2] * v.x + bm[mIdx + 6] * v.y + bm[mIdx + 10] * v.z + bm[mIdx + 14] * v.w) * w;
      aw += (bm[mIdx + 3] * v.x + bm[mIdx + 7] * v.y + bm[mIdx + 11] * v.z + bm[mIdx + 15] * v.w) * w;
    }
    if (aw !== 0) { ax /= aw; ay /= aw; az /= aw; }
    v3.set(ax, ay, az);
    box.expandByPoint(v3);
  }
  const size = box.getSize(new THREE.Vector3());
  return { maxDim: Math.max(size.x, size.y, size.z), size: size.toArray().map((x) => x.toFixed(2)) };
}

// unifySkeletons: mismo criterio que BunnyViewer (por referencia de array de huesos).
function unifySkeletons(object) {
  const skinnedMeshes = [];
  object.traverse((c) => { if (c instanceof THREE.SkinnedMesh) skinnedMeshes.push(c); });
  if (skinnedMeshes.length === 0) return;
  const unique = new Map();
  for (const sm of skinnedMeshes) if (sm.skeleton) unique.set(sm.skeleton.bones, sm.skeleton);
  console.log(`    SkinnedMesh: ${skinnedMeshes.length}, skeletons únicos: ${unique.size}`);
  if (unique.size <= 1) return;
  let master = null, maxBones = 0;
  for (const skel of unique.values()) if (skel.bones.length > maxBones) { maxBones = skel.bones.length; master = skel; }
  const masterIndex = new Map();
  for (let i = 0; i < master.bones.length; i++) masterIndex.set(master.bones[i].name, i);
  for (const sm of skinnedMeshes) {
    if (sm.skeleton === master) continue;
    const old = sm.skeleton;
    const skinIndexAttr = sm.geometry.attributes.skinIndex;
    const skinWeightAttr = sm.geometry.attributes.skinWeight;
    const oldBones = old.bones;
    const arr = skinIndexAttr.array;
    const vertexCount = skinIndexAttr.count;
    const numInf = skinIndexAttr.itemSize;
    for (let v = 0; v < vertexCount; v++) {
      for (let i = 0; i < numInf; i++) {
        const idx = v * numInf + i;
        const oldIdx = arr[idx];
        if (oldIdx >= 0 && oldIdx < oldBones.length) {
          const ni = masterIndex.get(oldBones[oldIdx].name);
          if (ni !== undefined) arr[idx] = ni;
          else { arr[idx] = 0; if (skinWeightAttr) skinWeightAttr.array[idx] = 0; }
        }
      }
    }
    skinIndexAttr.needsUpdate = true;
    if (skinWeightAttr) skinWeightAttr.needsUpdate = true;
    sm.skeleton = master;
  }
}

function applyAppPipeline(root) {
  unifySkeletons(root);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 2 / maxDim;
  root.scale.set(scale, scale, scale);
  const newBox = new THREE.Box3().setFromObject(root);
  const center = newBox.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -center.y, -center.z);
  return { maxDim, scale, bindSize: size.toArray().map((x) => x.toFixed(2)) };
}

console.log('\n=== 3) PIPELINE REAL (unifySkeletons + escala) ===');
for (const [label, root] of [['A direct', rootA], ['B worker', rootB]]) {
  const p = applyAppPipeline(root);
  const sk = skinnedBox(root);
  console.log(`  ${label}: bind maxDim=${p.maxDim.toFixed(2)} scale=${p.scale.toFixed(5)} bindSize=[${p.bindSize}]`);
  console.log(`     RENDERIZADO FINAL (skinned × scale) maxDim=${(sk.maxDim * p.scale).toFixed(4)} size=[${sk.size}]`);
}

// Root info
console.log('\n=== ROOT ===');
for (const [label, root] of [['A direct', rootA], ['B worker', rootB]]) {
  console.log(`  ${label}: type=${root.type} name=${root.name || '(sin nombre)'} children=${root.children.length}`);
  const rot = root.rotation.toArray().slice(0, 3).map((x) => x.toFixed(3)).join(',');
  const scl = root.scale.toArray().map((x) => x.toFixed(3)).join(',');
  const pos = root.position.toArray().map((x) => x.toFixed(3)).join(',');
  console.log(`     position=[${pos}] rotation=[${rot}] scale=[${scl}]`);
}
