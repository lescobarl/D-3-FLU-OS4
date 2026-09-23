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
 * Esta puerta decide UNA vez y reparte: en navegador usa `window.localStorage`;
 * fuera de el (Node, SSR, test sin DOM) cae a un mapa en MEMORIA. El mapa es de
 * modulo, no por llamada: uno nuevo por llamada perderia lo que se acaba de
 * escribir (era el defecto latente de resolver el storage en cada acceso).
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

/** Respaldo en memoria, vivo mientras dure el modulo. */
const MEMORY = new Map<string, string>();

let port: LocalStorePort | null = null;
let real = false;

function memoryPort(): LocalStorePort {
  return {
    getItem: (key) => MEMORY.get(key) ?? null,
    setItem: (key, value) => {
      MEMORY.set(key, value);
    },
    removeItem: (key) => {
      MEMORY.delete(key);
    },
  };
}

function resolvePort(): LocalStorePort {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      real = true;
      return window.localStorage;
    }
  } catch (e) {
    logCaughtError('[catch] src/core/storage/localStore.ts', e);
    // Acceso bloqueado (cookies de terceros, modo privado): se usa memoria.
  }
  return memoryPort();
}

/** La puerta, resuelta una sola vez. Es lo que consume `resolveSafeStorage`. */
export function localStorePort(): LocalStorePort {
  if (!port) port = resolvePort();
  return port;
}

/** true si detras hay almacenamiento real (no el respaldo en memoria). */
export function hasLocalStorage(): boolean {
  localStorePort();
  return real;
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
