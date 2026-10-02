import * as THREE from 'three';
import { REQUEST_TIMEOUT_DEFAULTS } from '../../core/config/sharedConfig';
import { isWorkerRuntime } from '../../lib/workerRuntime';
import { createWorkerPendingBridge } from '../../voice/lib/workerPendingBridge.js';

/**
 * Cliente del Web Worker de parseo FBX (espejo de voiceIdWorkerClient.js).
 *
 * Expone `loadFbx(url): Promise<THREE.Group>`: descarga + parsea el FBX en un
 * worker (sin bloquear el hilo principal) y reconstruye el grupo en el main
 * thread con THREE.ObjectLoader a partir del JSON serializado.
 *
 * Convenciones heredadas de voiceIdWorkerClient:
 *  - `new Worker(new URL('./fbxLoader.worker.js', import.meta.url), { type: 'module' })`
 *  - ids correlacionados, mapa de pendientes, timeout y `worker.onerror`
 *    (rechaza todos los pendientes y marca el worker como muerto).
 *  - `runMainThreadFallback` como respaldo cuando el worker no está disponible
 *    (navegadores sin Worker, bundle prod que externaliza 'three', etc.).
 *    El respaldo produce el MISMO resultado, solo que bloqueante.
 */

const workerRequestMs = REQUEST_TIMEOUT_DEFAULTS.WORKER_MS;

interface PendingEntry {
  resolve: (json: unknown) => void;
  reject: (reason: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

let workerDead = false;
let seq = 0;

// Esqueleto comun (P8.9): creacion perezosa + despacho por id + fail-all.
const bridge = createWorkerPendingBridge({
  createWorker: () =>
    new Worker(new URL('./fbxLoader.worker.js', import.meta.url), { type: 'module' }),
  // Sin runtime de worker, o si el worker ya murio, no se recrea.
  canRun: () => isWorkerRuntime() && !workerDead,
  label: 'fbx',
  valueKey: 'json',
  failMessage: 'fbx worker failed',
  onFatal: (_reason, api) => {
    // Fallo fatal del worker (p.ej. fallo el bundle en prod): marcarlo como
    // muerto para no recrearlo en cada request y fallar al fallback.
    workerDead = true;
    api.terminate();
  },
});

function postLoad(url: string): Promise<unknown> {
  const w = bridge.ensure();
  if (!w) return runMainThreadFallback(url);

  const id = `fbx-${Date.now()}-${(seq += 1)}`;
  return new Promise((resolve, reject) => {
    const entry: PendingEntry = { resolve, reject };
    bridge.pending.set(id, entry);
    const timer = setTimeout(() => {
      if (!bridge.pending.has(id)) return;
      bridge.pending.delete(id);
      reject(new Error(`fbx worker timeout (${url})`));
    }, workerRequestMs);
    entry.timer = timer;
    w.postMessage({ id, url });
  });
}

/**
 * Fallback main-thread: llama a la MISMA orquestacion compartida (fetchFbxJson) pero en
 * el hilo principal. Es bloqueante, pero garantiza que la app funciona aunque
 * el worker no arranque. En main thread `installDomShim()` es no-op (document
 * existe), de modo que el comportamiento es idéntico al FBXLoader.load actual.
 */
async function runMainThreadFallback(url: string): Promise<unknown> {
  const { fetchFbxJson } = await import('../lib/fbxParse');
  return fetchFbxJson(url);
}

/**
 * Carga un modelo/animación FBX sin bloquear el hilo principal.
 *
 * El parseo síncrono de FBXLoader se ejecuta en un Web Worker; el resultado
 * viaja serializado (group.toJSON()) y se reconstruye aquí con ObjectLoader.
 *
 * ObjectLoader.parse restaura matrices locales, pero NO calcula matrixWorld
 * (queda identidad). Un FBXLoader.parse directo sí lo deja calculado (el
 * transformLink de los huesos). Sin este update, Box3.setFromObject (que usa
 * matrixWorld) mide la caja de bind 3x más pequeña y el bloque de escalado
 * del viewer agranda el modelo (el bug del Flu gigante). updateMatrixWorld(true)
 * recalcula todo el grafo con force, restaurando el estado equivalente al
 * parse directo.
 *
 * @param url ruta pública del archivo FBX.
 * @returns el grupo THREE listo para unifySkeletons/repairFBXMaterials/mixer.
 */
export async function loadFbx(url: string): Promise<THREE.Group> {
  const json = await postLoad(url);
  // El JSON proviene de group.toJSON() de un FBXLoader.parse (siempre un Group
  // raíz); ObjectLoader lo reconstruye con ese type. El cast es necesario
  // porque la firma de ObjectLoader.parse devuelve Object3D.
  const group = new THREE.ObjectLoader().parse(json as Record<string, unknown>) as THREE.Group;
  // Restaura matrixWorld de todo el grafo (padre→hijo) al estado que dejaría
  // un FBXLoader.parse directo. Es lo que espera el bloque de escalado del
  // viewer (Box3.setFromObject → scale = targetSize/maxDim).
  group.updateMatrixWorld(true);
  return group;
}
