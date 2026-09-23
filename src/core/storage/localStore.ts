/**
 * Una sola puerta al almacenamiento local del navegador.
 *
 * ANTES (medido): cuatro invenciones distintas del "storage seguro" —
 * `resolveSafeStorage` (src/store/storage.ts), `readStorage`/`writeStorage`
 * (appConfig), `safeGet` con respaldo a sessionStorage (searchConfigOverrides)
 * y `getLocalStorage` (onboardingService) — mas 117 menciones directas a
 * `localStorage` repartidas por src. Cada sitio decidia por su cuenta si el
 * almacen existe y a donde caer.
 *
 * Esta puerta es el unico sitio que mira si hay almacenamiento: en navegador usa
 * `window.localStorage`, y fuera de el (Node, SSR, test sin DOM) cae a un mapa en
 * MEMORIA que es de modulo y no por acceso (un mapa nuevo por acceso perderia lo
 * que se acaba de escribir). La resolucion SI es por acceso, para que quien
 * sustituya el almacenamiento —los tests lo hacen— siga mandando.
 *
 * NO captura los errores del almacen a proposito: quien se llena tiene que
 * poder enterarse. `backupSystem` poda backups antiguos justo al ver el
 * QuotaExceededError, asi que tragarselo aqui romperia esa recuperacion.
 */
import { logCaughtError } from '../../lib/caughtError';

/**
 * Lo que la puerta expone. `length`/`key` son opcionales: los tiene el
 * almacenamiento real y no el de memoria (que usa `localKeys`).
 */
export interface LocalStorePort {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  length?: number;
  key?: (index: number) => string | null;
}

/** Respaldo en memoria: UNO por modulo, no uno por acceso. */
const MEMORY = new Map<string, string>();

let memory: LocalStorePort | null = null;

function memoryPort(): LocalStorePort {
  if (!memory) {
    memory = {
      getItem: (key) => MEMORY.get(key) ?? null,
      setItem: (key, value) => {
        MEMORY.set(key, value);
      },
      removeItem: (key) => {
        MEMORY.delete(key);
      },
    };
  }
  return memory;
}

/** El almacen del navegador, o null si no hay (Node/SSR, o acceso bloqueado). */
function browserStorage(): LocalStorePort | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (e) {
    logCaughtError('[catch] src/core/storage/localStore.ts', e);
    // Acceso bloqueado (cookies de terceros, modo privado): se usa memoria.
  }
  return null;
}

/**
 * La puerta, resuelta EN CADA ACCESO y a proposito: quien sustituya el
 * almacenamiento tiene que seguir mandando (los tests lo hacen) y no hay que
 * cachear una referencia que puede dejar de ser valida. Lo unico unico es el
 * respaldo en memoria, que es donde estaba el defecto: un mapa nuevo por acceso
 * perdia lo escrito en el acto.
 */
export function localStorePort(): LocalStorePort {
  return browserStorage() ?? memoryPort();
}

/** true si detras hay almacenamiento del navegador (no el respaldo en memoria). */
export function hasLocalStorage(): boolean {
  return browserStorage() !== null;
}

export function localGet(key: string): string | null {
  return localStorePort().getItem(key);
}

/** `String(value)` replica la coercion de la plataforma: escribe lo mismo. */
export function localSet(key: string, value: string | number | boolean): void {
  localStorePort().setItem(key, String(value));
}

export function localRemove(key: string): void {
  localStorePort().removeItem(key);
}

/** Claves presentes. Sustituye el barrido manual `length` + `key(i)`. */
export function localKeys(): string[] {
  const p = localStorePort();
  if (typeof p.length !== 'number' || typeof p.key !== 'function') return [...MEMORY.keys()];
  const out: string[] = [];
  for (let i = 0; i < p.length; i += 1) {
    const k = p.key(i);
    if (k !== null) out.push(k);
  }
  return out;
}
