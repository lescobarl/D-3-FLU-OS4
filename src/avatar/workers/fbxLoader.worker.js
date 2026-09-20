/**
 * Web Worker de parseo FBX.
 *
 * Recibe { id, url }, descarga el buffer y ejecuta parseFbxBuffer (que usa
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
import { parseFbxBuffer } from '../lib/fbxParse';

self.onmessage = async (event) => {
  const { id, url } = event.data || {};
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`fetch FBX falló: HTTP ${response.status} para ${url}`);
    }
    const buffer = await response.arrayBuffer();
    const group = parseFbxBuffer(buffer, url);
    self.postMessage({ id, ok: true, json: group.toJSON() });
  } catch (err) {
        console.warn('[catch] src/avatar/workers/fbxLoader.worker.js:', err);
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
