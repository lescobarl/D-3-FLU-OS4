// ============================================================
// onboardingService — Multiusuario (Fase 3): onboarding por usuario
// ------------------------------------------------------------
// Cubre los helpers puros (usuario activo, estado legacy de
// localStorage, mapeo de registros Dexie) y el servicio con
// Inyección de Dependencias (OnboardingDb en memoria, reloj y
// newId inyectables, misma interfaz que communicationProfileService).
// Regla #1: sin hardcode — claves desde STORAGE_KEYS y el id legacy
// es DEFAULT_ONBOARDING_USER.
// Regla de oro: funciones puras y deterministas.
// Obligación #5: log de auditoría en cada mutación.
// Obligación #6/#7: sync con revision + timestamp ISO.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAuditLog, type OnboardingStateRecord, type SyncTuple } from '../src/core/db/fluDatabase';
import { STORAGE_KEYS } from '../src/core/config/appConfig';
import { createInitialState, type OnboardingState } from '../src/core/onboarding/onboardingFlow';
import {
  createOnboardingRecord,
  createOnboardingService,
  DEFAULT_ONBOARDING_USER,
  getLocalStorage,
  onboardingStateFromRecord,
  readLegacyOnboarding,
  resolveActiveUser,
  setActiveUser,
  type OnboardingDb,
  type OnboardingService,
} from '../src/core/onboarding/onboardingService';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría
// (fluDatabase no abre la conexión hasta la primera operación real).
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;

let idCounter = 0;

function makeState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    stepIndex: 1,
    completed: false,
    captured: { name: 'Ana' },
    startedAt: NOW,
    ...overrides,
  };
}

function makeRecord(overrides: Partial<OnboardingStateRecord> = {}): OnboardingStateRecord {
  return {
    id: 'papa-1',
    stepIndex: 0,
    completed: false,
    captured: {},
    startedAt: NOW,
    updatedAt: NOW,
    sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
    ...overrides,
  };
}

function createMapDb(
  initial: OnboardingStateRecord[] = [],
): OnboardingDb & { toArray: () => Promise<OnboardingStateRecord[]> } {
  const rows = new Map<string, OnboardingStateRecord>();
  for (const r of initial) rows.set(r.id, { ...r, captured: { ...r.captured }, sync: { ...r.sync } });
  return {
    async get(id: string): Promise<OnboardingStateRecord | undefined> {
      const r = rows.get(id);
      return r ? { ...r, captured: { ...r.captured }, sync: { ...r.sync } } : undefined;
    },
    async put(record: OnboardingStateRecord): Promise<unknown> {
      rows.set(record.id, { ...record, captured: { ...record.captured }, sync: { ...record.sync } });
      return undefined;
    },
    async delete(id: string): Promise<void> {
      rows.delete(id);
    },
    async toArray(): Promise<OnboardingStateRecord[]> {
      return Array.from(rows.values()).map((r) => ({ ...r, captured: { ...r.captured }, sync: { ...r.sync } }));
    },
  };
}

function createService(db: OnboardingDb): OnboardingService {
  return createOnboardingService({
    db,
    now,
    newId: () => `ob-${++idCounter}`,
  });
}

// Storage en memoria compatible con la interfaz DOM (sin window real).
function createFakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length(): number {
      return map.size;
    },
    clear(): void {
      map.clear();
    },
    getItem(key: string): string | null {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    key(index: number): string | null {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    setItem(key: string, value: string): void {
      map.set(key, String(value));
    },
  } as Storage;
}

let db: OnboardingDb & { toArray: () => Promise<OnboardingStateRecord[]> };

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  db = createMapDb();
});

// ------------------------------------------------------------
// Helpers puros — usuario activo (legacy 'default' vs participante)
// ------------------------------------------------------------
describe('onboardingService — usuario activo (resolveActiveUser / setActiveUser)', () => {
  it('DEFAULT_ONBOARDING_USER es "default" (usuario legacy sin participante)', () => {
    expect(DEFAULT_ONBOARDING_USER).toBe('default');
  });

  it('resolveActiveUser sin clave cae al usuario legacy "default"', () => {
    expect(resolveActiveUser(createFakeStorage())).toBe(DEFAULT_ONBOARDING_USER);
  });

  it('resolveActiveUser normaliza "default", vacío y espacios al legacy', () => {
    const storage = createFakeStorage({ [STORAGE_KEYS.ACTIVE_USER]: 'default' });
    expect(resolveActiveUser(storage)).toBe(DEFAULT_ONBOARDING_USER);
    storage.setItem(STORAGE_KEYS.ACTIVE_USER, '');
    expect(resolveActiveUser(storage)).toBe(DEFAULT_ONBOARDING_USER);
    storage.setItem(STORAGE_KEYS.ACTIVE_USER, '   ');
    expect(resolveActiveUser(storage)).toBe(DEFAULT_ONBOARDING_USER);
  });

  it('resolveActiveUser devuelve el id del participante activo', () => {
    const storage = createFakeStorage({ [STORAGE_KEYS.ACTIVE_USER]: 'papa-1' });
    expect(resolveActiveUser(storage)).toBe('papa-1');
  });

  it('resolveActiveUser sin argumento no rompe (entorno sin window)', () => {
    expect(typeof resolveActiveUser()).toBe('string');
  });

  it('setActiveUser sin storage no hace nada y no lanza', () => {
    expect(() => setActiveUser(undefined, 'papa-1')).not.toThrow();
  });

  it('setActiveUser con undefined, vacío, "default" o espacios limpia la clave', () => {
    for (const id of [undefined, '', 'default', '   ']) {
      const storage = createFakeStorage({ [STORAGE_KEYS.ACTIVE_USER]: 'papa-1' });
      setActiveUser(storage, id);
      expect(storage.getItem(STORAGE_KEYS.ACTIVE_USER)).toBeNull();
    }
  });

  it('setActiveUser con un id real lo persiste limpio (sin espacios)', () => {
    const storage = createFakeStorage();
    setActiveUser(storage, '  papa-1  ');
    expect(storage.getItem(STORAGE_KEYS.ACTIVE_USER)).toBe('papa-1');
  });

  it('getLocalStorage está expuesto como función', () => {
    expect(typeof getLocalStorage).toBe('function');
  });
});

// ------------------------------------------------------------
// Helpers puros — estado legacy de localStorage (Fase 1)
// ------------------------------------------------------------
describe('onboardingService — estado legacy (readLegacyOnboarding)', () => {
  it('sin storage devuelve el estado inicial sin completar', () => {
    const state = readLegacyOnboarding(undefined);
    expect(state).toMatchObject({ stepIndex: 0, completed: false, captured: {} });
  });

  it('sin claves guardadas devuelve el estado inicial', () => {
    const state = readLegacyOnboarding(createFakeStorage());
    expect(state).toMatchObject({ stepIndex: 0, completed: false, captured: {} });
  });

  it('ONBOARDING_COMPLETED=true marca completado conservando el paso 0', () => {
    const storage = createFakeStorage({ [STORAGE_KEYS.ONBOARDING_COMPLETED]: 'true' });
    expect(readLegacyOnboarding(storage)).toMatchObject({ stepIndex: 0, completed: true, captured: {} });
  });

  it('restaura stepIndex y captured desde ONBOARDING_STEP (JSON válido)', () => {
    const storage = createFakeStorage({
      [STORAGE_KEYS.ONBOARDING_STEP]: JSON.stringify({ stepIndex: 2, captured: { name: 'Ana' } }),
    });
    const state = readLegacyOnboarding(storage);
    expect(state.stepIndex).toBe(2);
    expect(state.captured).toEqual({ name: 'Ana' });
    expect(typeof state.startedAt).toBe('number');
  });

  it('combina completed con el paso restaurado', () => {
    const storage = createFakeStorage({
      [STORAGE_KEYS.ONBOARDING_COMPLETED]: 'true',
      [STORAGE_KEYS.ONBOARDING_STEP]: JSON.stringify({ stepIndex: 3, captured: { name: 'Papá' } }),
    });
    const state = readLegacyOnboarding(storage);
    expect(state).toMatchObject({ stepIndex: 3, completed: true, captured: { name: 'Papá' } });
  });

  it('JSON corrupto o con campos inválidos cae al estado inicial sin romper', () => {
    const corrupt = createFakeStorage({
      [STORAGE_KEYS.ONBOARDING_STEP]: 'no-json',
    });
    expect(readLegacyOnboarding(corrupt)).toMatchObject({ stepIndex: 0, completed: false, captured: {} });

    const badTypes = createFakeStorage({
      [STORAGE_KEYS.ONBOARDING_STEP]: JSON.stringify({ stepIndex: 'mal', captured: 'nope' }),
    });
    expect(readLegacyOnboarding(badTypes)).toMatchObject({ stepIndex: 0, completed: false, captured: {} });
  });
});

// ------------------------------------------------------------
// Helpers puros — mapeo entre estado y registro Dexie
// ------------------------------------------------------------
describe('onboardingService — mapeo de registros', () => {
  it('onboardingStateFromRecord sin registro devuelve el estado inicial', () => {
    const state = onboardingStateFromRecord(undefined);
    expect(state).toMatchObject({ stepIndex: 0, completed: false, captured: {} });
    expect(typeof state.startedAt).toBe('number');
  });

  it('onboardingStateFromRecord traduce el registro y copia captured', () => {
    const record = makeRecord({ stepIndex: 3, completed: true, captured: { name: 'Ana' } });
    const state = onboardingStateFromRecord(record);
    expect(state).toEqual({ stepIndex: 3, completed: true, captured: { name: 'Ana' }, startedAt: NOW });
    // Copia: mutar el estado no altera el registro.
    state.captured.extra = 'x';
    expect(record.captured.extra).toBeUndefined();
  });

  it('createOnboardingRecord construye el registro con now y sync pasados', () => {
    const sync: SyncTuple = { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false };
    const record = createOnboardingRecord('papa-1', makeState(), NOW, sync);
    expect(record).toEqual({
      id: 'papa-1',
      stepIndex: 1,
      completed: false,
      captured: { name: 'Ana' },
      startedAt: NOW,
      updatedAt: NOW,
      sync,
    });
  });
});

// ------------------------------------------------------------
// Servicio — load / save / reset (DI + auditoría + sync)
// ------------------------------------------------------------
describe('onboardingService — servicio con DI', () => {
  it('load sin registro devuelve el estado inicial y no audita', async () => {
    const svc = createService(db);
    const state = await svc.load('papa-1');
    expect(state).toMatchObject({ stepIndex: 0, completed: false, captured: {} });
    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('load con registro devuelve el estado persistido', async () => {
    const seeded = createMapDb([
      makeRecord({ id: 'papa-1', stepIndex: 2, completed: false, captured: { name: 'Ana' } }),
    ]);
    const svc = createService(seeded);
    const state = await svc.load('papa-1');
    expect(state).toEqual({ stepIndex: 2, completed: false, captured: { name: 'Ana' }, startedAt: NOW });
  });

  it('save nuevo persiste con sync revision 1, updatedAt del reloj y audita', async () => {
    const svc = createService(db);
    const state = makeState();

    await svc.save('papa-1', state);

    const rows = await db.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'papa-1',
      stepIndex: 1,
      completed: false,
      captured: { name: 'Ana' },
      updatedAt: NOW,
    });
    expect(rows[0].sync).toEqual({ revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false });

    expect(addAuditLog).toHaveBeenCalledTimes(1);
    expect(addAuditLog).toHaveBeenCalledWith(
      'onboarding.save',
      'onboardingStates',
      'papa-1',
      expect.objectContaining({ stepIndex: 0, completed: false, captured: {} }),
      state,
      'onboardingService',
    );
  });

  it('save sobre un registro existente sube la revisión sync a 2', async () => {
    const seeded = createMapDb([makeRecord({ id: 'papa-1' })]);
    const svc = createService(seeded);
    const state = makeState({ stepIndex: 4, completed: true });

    await svc.save('papa-1', state);

    const rows = await seeded.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].sync.revision).toBe(2);
    expect(rows[0].updatedAt).toBe(NOW);
    expect(addAuditLog).toHaveBeenCalledWith(
      'onboarding.save',
      'onboardingStates',
      'papa-1',
      expect.objectContaining({ stepIndex: 0, completed: false, captured: {} }),
      state,
      'onboardingService',
    );
  });

  it('reset borra el registro y audita con el estado previo y null', async () => {
    const seeded = createMapDb([
      makeRecord({ id: 'papa-1', stepIndex: 5, completed: true, captured: { name: 'Ana' } }),
    ]);
    const svc = createService(seeded);

    await svc.reset('papa-1');

    expect(await seeded.toArray()).toHaveLength(0);
    expect(addAuditLog).toHaveBeenCalledWith(
      'onboarding.reset',
      'onboardingStates',
      'papa-1',
      expect.objectContaining({ stepIndex: 5, completed: true, captured: { name: 'Ana' } }),
      null,
      'onboardingService',
    );
  });

  it('reset sin registro no lanza y audita con el estado inicial como previo', async () => {
    const svc = createService(db);

    await expect(svc.reset('ghost')).resolves.toBeUndefined();

    expect(addAuditLog).toHaveBeenCalledWith(
      'onboarding.reset',
      'onboardingStates',
      'ghost',
      expect.objectContaining({ stepIndex: 0, completed: false, captured: {} }),
      null,
      'onboardingService',
    );
  });

  it('load devuelve copias (mutar el resultado no altera lo persistido)', async () => {
    const seeded = createMapDb([makeRecord({ id: 'papa-1' })]);
    const svc = createService(seeded);

    const state = await svc.load('papa-1');
    state.captured.hack = 'x';
    const again = await svc.load('papa-1');
    expect(again.captured.hack).toBeUndefined();
    expect(createInitialState()).toMatchObject({ stepIndex: 0, completed: false, captured: {} });
  });
});
