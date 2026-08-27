import * as THREE from 'three';

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

const WORKER_REQUEST_TIMEOUT_MS = 45000;

interface PendingEntry {
  resolve: (json: unknown) => void;
  reject: (reason: Error) => void;
  url: string;
  timer?: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let workerDead = false;
let seq = 0;
const pending = new Map<string, PendingEntry>();

function isWorkerRuntime(): boolean {
  return typeof Worker !== 'undefined';
}

function ensureWorker(): Worker | null {
  if (!isWorkerRuntime()) return null;
  if (workerDead) return null;
  if (worker) return worker;

  worker = new Worker(new URL('./fbxLoader.worker.js', import.meta.url), {
    type: 'module',
  });

  worker.onmessage = (event: MessageEvent) => {
    const { id, ok, json, error } = event.data || {};
    const entry = pending.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    pending.delete(id);
    if (ok) entry.resolve(json);
    else entry.reject(new Error(error || 'fbx worker failed'));
  };

  worker.onerror = (event: ErrorEvent) => {
    // Fallo fatal del worker (p.ej. falló el bundle en prod): marcar como
    // muerto para no recrearlo en cada request y fallar al fallback.
    workerDead = true;
    const reason = new Error(event?.message || 'fbx worker error');
    for (const [, entry] of pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(reason);
    }
    pending.clear();
    if (worker) {
      worker.terminate();
      worker = null;
    }
  };

  return worker;
}

function postLoad(url: string): Promise<unknown> {
  const w = ensureWorker();
  if (!w) return runMainThreadFallback(url);

  const id = `fbx-${Date.now()}-${(seq += 1)}`;
  return new Promise((resolve, reject) => {
    const entry: PendingEntry = { resolve, reject, url };
    pending.set(id, entry);
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`fbx worker timeout (${url})`));
    }, WORKER_REQUEST_TIMEOUT_MS);
    entry.timer = timer;
    w.postMessage({ id, url });
  });
}

/**
 * Fallback main-thread: mismo flujo (fetch + parseFbxBuffer + toJSON) pero en
 * el hilo principal. Es bloqueante, pero garantiza que la app funciona aunque
 * el worker no arranque. En main thread `installDomShim()` es no-op (document
 * existe), de modo que el comportamiento es idéntico al FBXLoader.load actual.
 */
async function runMainThreadFallback(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch FBX falló: HTTP ${response.status} para ${url}`);
  }
  const buffer = await response.arrayBuffer();
  const { parseFbxBuffer } = await import('../lib/fbxParse');
  const group = parseFbxBuffer(buffer, url);
  return group.toJSON();
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

/** Estadísticas útiles para diagnóstico/verificación. */
export function getFbxWorkerStats() {
  return {
    worker: !!worker,
    workerDead,
    pending: pending.size,
  };
}

/** Terminación explícita del worker (opcional; vive mientras la app). */
export function terminateFbxWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}
