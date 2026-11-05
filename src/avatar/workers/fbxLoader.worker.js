/**
 * Web Worker de parseo FBX.
 *
 * Recibe { id, url }, descarga el buffer y ejecuta fetchFbxJson (que usa
 * THREE.FBXLoader.parse — síncrono) FUERA del hilo principal. Devuelve el
 * árbol serializado (group.toJSON()) para reconstruir con THREE.ObjectLoader
 * en el hilo principal.
 *
 * El `.toJSON()` es lo que hace posible atravesar el postMessage: los objetos
 * THREE no son clonables, pero su representación JSON sí (fidelidad probada:
 * meshes/skinned/bones/clips/vertices/skinIndex/skeleton).
 *
 * Archivo `.js` a propósito: coincide con la convención de voiceId.worker.js y
 * evita que tsc (lib DOM-only) tipifique el contexto de worker.
 */
import { fetchFbxJson } from '../lib/fbxParse';
import { logCaughtError } from '../../lib/caughtError';

self.onmessage = async (event) => {
  const { id, url } = event.data || {};
  try {
    const json = await fetchFbxJson(url);
    self.postMessage({ id, ok: true, json });
  } catch (err) {
        logCaughtError('[catch] src/avatar/workers/fbxLoader.worker.js', err);
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
