// ============================================================
// onboardingService — Estado de onboarding por usuario
// ------------------------------------------------------------
// Multiusuario (Fase 3): cada participante (papá/mamá/hijo) tiene
// su propio estado de primera configuración en Dexie (tabla v14
// onboardingStates). Ya NO hay ruta paralela en localStorage: el estado de
// onboarding (incluida la fase sin participante) vive SOLO en Dexie.
//
// Cumple:
//  - Regla #1 (no hardcode): claves de almacenamiento desde
//    STORAGE_KEYS y el id legacy es DEFAULT_ONBOARDING_USER.
//  - Obligación #1 (DI): { db, now, newId } inyectados.
//  - Obligación #5 (auditoría): save/reset pasan por addAuditLog.
//  - Obligación #6/#7: sync con revision + timestamp ISO.
// ============================================================
import { v4 as uuidv4 } from 'uuid';
import { addAuditLog, type OnboardingStateRecord, type SyncTuple } from '../db/fluDatabase';
import { buildSyncTuple } from '../db/syncTuple';
import { STORAGE_KEYS } from '../config/appConfig';
import { createInitialState, type OnboardingState } from './onboardingFlow';

export type { OnboardingStateRecord } from '../db/fluDatabase';
export type { OnboardingState } from './onboardingFlow';

/** Id del usuario legacy basado en localStorage (sin participante). */
export const DEFAULT_ONBOARDING_USER = 'default';

export interface OnboardingDb {
  get(id: string): Promise<OnboardingStateRecord | undefined>;
  put(record: OnboardingStateRecord): Promise<unknown>;
  delete(id: string): Promise<void>;
}

export interface OnboardingServiceOptions {
  db: OnboardingDb;
  now?: () => number;
  newId?: () => string;
}

export interface OnboardingService {
  load(id: string): Promise<OnboardingState>;
  save(id: string, state: OnboardingState): Promise<void>;
  reset(id: string): Promise<void>;
}

// -----------------------------------------------------------
// Helpers puros
// -----------------------------------------------------------

/** Traduce un registro de Dexie a estado de onboarding (o inicial). */
export function onboardingStateFromRecord(record?: OnboardingStateRecord): OnboardingState {
  if (!record) return createInitialState();
  return {
    stepIndex: record.stepIndex,
    completed: record.completed,
    captured: { ...record.captured },
    startedAt: record.startedAt,
  };
}

/** Construye un registro de Dexie desde el estado (con sync y updatedAt). */
export function createOnboardingRecord(
  id: string,
  state: OnboardingState,
  now: number,
  sync: SyncTuple,
): OnboardingStateRecord {
  return {
    id,
    stepIndex: state.stepIndex,
    completed: state.completed,
    captured: { ...state.captured },
    startedAt: state.startedAt,
    updatedAt: now,
    sync,
  };
}

export function getLocalStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage;
}

/** Usuario activo: STORAGE_KEYS.ACTIVE_USER o el legacy 'default'. */
export function resolveActiveUser(storage: Storage | undefined = getLocalStorage()): string {
  const raw = storage?.getItem(STORAGE_KEYS.ACTIVE_USER);
  const id = raw?.trim() || '';
  return id && id !== DEFAULT_ONBOARDING_USER ? id : DEFAULT_ONBOARDING_USER;
}

/** Persiste el usuario activo; ''/'default' limpia la clave. */
export function setActiveUser(storage: Storage | undefined = getLocalStorage(), id?: string): void {
  if (!storage) return;
  const clean = id?.trim() || '';
  if (!clean || clean === DEFAULT_ONBOARDING_USER) {
    storage.removeItem(STORAGE_KEYS.ACTIVE_USER);
    return;
  }
  storage.setItem(STORAGE_KEYS.ACTIVE_USER, clean);
}

// -----------------------------------------------------------
// Servicio
// -----------------------------------------------------------

export function createOnboardingService({
  db,
  now = () => Date.now(),
  newId: _newId = uuidv4,
}: OnboardingServiceOptions): OnboardingService {
  const load = async (id: string): Promise<OnboardingState> => {
    const record = await db.get(id);
    if (record?.sync?.deleted) return onboardingStateFromRecord(undefined);
    return onboardingStateFromRecord(record);
  };

  const save = async (id: string, state: OnboardingState): Promise<void> => {
    const previous = await db.get(id);
    const record = createOnboardingRecord(id, state, now(), buildSyncTuple(previous?.sync, now()));
    await db.put(record);
    await addAuditLog(
      'onboarding.save',
      'onboardingStates',
      id,
      onboardingStateFromRecord(previous),
      state,
      'onboardingService',
    );
  };

  const reset = async (id: string): Promise<void> => {
    const previous = await db.get(id);
    if (previous) {
      await db.put({
        ...previous,
        sync: { ...buildSyncTuple(previous.sync, now()), deleted: true },
      });
    }
    await addAuditLog(
      'onboarding.reset',
      'onboardingStates',
      id,
      onboardingStateFromRecord(previous),
      null,
      'onboardingService',
    );
  };

  return { load, save, reset };
}
