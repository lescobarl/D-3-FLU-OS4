// ============================================================
// communicationProfileService — FASE P: Personalización profunda por persona
// ------------------------------------------------------------
// Cubre los helpers puros (detección es/en, confianza, resolución,
// TTS, registro por defecto y fusión de observaciones) y el servicio
// con Inyección de Dependencias (misma interfaz CommunicationProfilesDb
// en memoria, reloj y newId inyectables).
// Regla #1: sin hardcode — niveles, tonos y TTS desde config.
// Regla de oro: funciones puras y deterministas.
// Obligación #5: log de auditoría en cada mutación.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAuditLog, type CommunicationProfileRecord } from '../src/core/db/fluDatabase';
import {
  computeProfileConfidence,
  createCommunicationProfileService,
  defaultRecord,
  detectExplanationLevel,
  detectToneFromText,
  EXPLANATION_LEVELS,
  mergeObservation,
  resolveExplanationLevel,
  resolveTone,
  TONE_OPTIONS,
  ttsRateForLevel,
  type CommunicationProfileConfig,
  type CommunicationProfilesDb,
} from '../src/core/personalization/communicationProfileService';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría
// (fluDatabase no abre la conexión hasta la primera operación real).
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;

// Misma forma que FLU_CONFIG.personalization (config-driven, sin hardcode).
const CONFIG: CommunicationProfileConfig = {
  defaultTone: 'friendly',
  defaultExplanationLevel: 'detallado',
  ttsRateByLevel: { simple: 1.05, detallado: 0.95, avanzado: 0.9 },
};

let idCounter = 0;

function makeRecord(overrides: Partial<CommunicationProfileRecord> = {}): CommunicationProfileRecord {
  return {
    id: 'seed-profile',
    participantId: 'p1',
    participantName: 'Ana',
    explanationLevel: 'detallado',
    tone: 'friendly',
    observationCount: 0,
    levelObservationCount: 0,
    toneObservationCount: 0,
    confidence: 0.15,
    source: 'default',
    createdAt: NOW,
    updatedAt: NOW,
    sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
    ...overrides,
  };
}

function createMapDb(initial: CommunicationProfileRecord[] = []): CommunicationProfilesDb {
  const rows = new Map<string, CommunicationProfileRecord>();
  for (const r of initial) rows.set(r.id, { ...r, sync: { ...r.sync } });
  return {
    async add(record: CommunicationProfileRecord): Promise<unknown> {
      rows.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async put(record: CommunicationProfileRecord): Promise<unknown> {
      rows.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async delete(id: string): Promise<void> {
      rows.delete(id);
    },
    async getByParticipant(participantId: string): Promise<CommunicationProfileRecord | undefined> {
      for (const r of rows.values()) {
        if (r.participantId === participantId) return { ...r, sync: { ...r.sync } };
      }
      return undefined;
    },
    async toArray(): Promise<CommunicationProfileRecord[]> {
      return Array.from(rows.values()).map((r) => ({ ...r, sync: { ...r.sync } }));
    },
  };
}

function createService(db: CommunicationProfilesDb, config: CommunicationProfileConfig = CONFIG) {
  return createCommunicationProfileService({
    db,
    config,
    now,
    newId: () => `profile-${++idCounter}`,
  });
}

let db: CommunicationProfilesDb;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  db = createMapDb();
});

// ------------------------------------------------------------
// Helpers puros — detección de nivel de explicación
// ------------------------------------------------------------
describe('communicationProfileService — detectExplanationLevel (es/en)', () => {
  it('detecta nivel simple en español', () => {
    expect(detectExplanationLevel('explícamelo simple')).toBe('simple');
    expect(detectExplanationLevel('hazlo breve, por favor')).toBe('simple');
    expect(detectExplanationLevel('resúmelo en una frase')).toBe('simple');
  });

  it('detecta nivel detallado en español', () => {
    expect(detectExplanationLevel('explícamelo a fondo')).toBe('detallado');
    expect(detectExplanationLevel('cuéntame paso a paso')).toBe('detallado');
    expect(detectExplanationLevel('dame más contexto')).toBe('detallado');
  });

  it('detecta nivel avanzado en español', () => {
    expect(detectExplanationLevel('explícamelo a nivel técnico')).toBe('avanzado');
    expect(detectExplanationLevel('háblame como experto')).toBe('avanzado');
  });

  it('detecta nivel simple/detallado/avanzado en inglés', () => {
    expect(detectExplanationLevel('keep it brief')).toBe('simple');
    expect(detectExplanationLevel('explain step by step')).toBe('detallado');
    expect(detectExplanationLevel('explain the internals')).toBe('avanzado');
  });

  it('devuelve null sin señal de nivel', () => {
    expect(detectExplanationLevel('¿qué hora es?')).toBeNull();
    expect(detectExplanationLevel('pon la alarma a las 6 am')).toBeNull();
  });
});

// ------------------------------------------------------------
// Helpers puros — detección de tono
// ------------------------------------------------------------
describe('communicationProfileService — detectToneFromText (es/en)', () => {
  it('detecta los tonos soportados en español', () => {
    expect(detectToneFromText('trátame de usted')).toBe('formal');
    expect(detectToneFromText('háblame casual')).toBe('casual');
    expect(detectToneFromText('háblame como amigo')).toBe('friendly');
    expect(detectToneFromText('usa un tono profesional')).toBe('professional');
    expect(detectToneFromText('contéstame con energía')).toBe('energetic');
    expect(detectToneFromText('háblame tranquilo')).toBe('calm');
  });

  it('detecta tono en inglés', () => {
    expect(detectToneFromText('speak formally')).toBe('formal');
    expect(detectToneFromText('keep it chill')).toBe('casual');
    expect(detectToneFromText('be friendly')).toBe('friendly');
  });

  it('devuelve null sin señal de tono', () => {
    expect(detectToneFromText('¿qué hora es?')).toBeNull();
  });
});

// ------------------------------------------------------------
// Helpers puros — confianza, resolución y TTS
// ------------------------------------------------------------
describe('communicationProfileService — helpers de resolución', () => {
  it('computeProfileConfidence usa base por fuente y boost por repetición', () => {
    expect(computeProfileConfidence(0, 'manual')).toBe(0.9);
    expect(computeProfileConfidence(0, 'auto')).toBeCloseTo(0.35);
    expect(computeProfileConfidence(0, 'default')).toBeCloseTo(0.15);
    // Boost: 4 * 0.05 = 0.2 → auto = 0.55
    expect(computeProfileConfidence(4, 'auto')).toBeCloseTo(0.55);
    // Tope 1: manual con muchas repeticiones
    expect(computeProfileConfidence(100, 'manual')).toBe(1);
  });

  it('resolveExplanationLevel prioriza manual > auto > fallback', () => {
    expect(
      resolveExplanationLevel({ manualExplanationLevel: 'simple', autoExplanationLevel: 'avanzado' }, 'detallado'),
    ).toBe('simple');
    expect(resolveExplanationLevel({ autoExplanationLevel: 'avanzado' }, 'detallado')).toBe('avanzado');
    expect(resolveExplanationLevel({}, 'detallado')).toBe('detallado');
  });

  it('resolveTone prioriza manual > auto > fallback', () => {
    expect(resolveTone({ manualTone: 'formal', autoTone: 'casual' }, 'friendly')).toBe('formal');
    expect(resolveTone({ autoTone: 'casual' }, 'friendly')).toBe('casual');
    expect(resolveTone({}, 'friendly')).toBe('friendly');
  });

  it('ttsRateForLevel lee de config y cae a 1 si falta', () => {
    expect(ttsRateForLevel('simple', CONFIG)).toBe(1.05);
    expect(ttsRateForLevel('detallado', CONFIG)).toBe(0.95);
    expect(ttsRateForLevel('avanzado', CONFIG)).toBe(0.9);
    expect(ttsRateForLevel('detallado', { ttsRateByLevel: {} as CommunicationProfileConfig['ttsRateByLevel'] })).toBe(1);
  });

  it('EXPLANATION_LEVELS y TONE_OPTIONS exponen los niveles/tonos esperados', () => {
    expect(EXPLANATION_LEVELS).toEqual(['simple', 'detallado', 'avanzado']);
    expect(TONE_OPTIONS).toContain('formal');
    expect(TONE_OPTIONS).toContain('calm');
  });
});

// ------------------------------------------------------------
// Helpers puros — defaultRecord y mergeObservation
// ------------------------------------------------------------
describe('communicationProfileService — defaultRecord y mergeObservation', () => {
  it('defaultRecord crea un registro por defecto completo', () => {
    const record = defaultRecord('p1', 'Ana', CONFIG, NOW, 'profile-1');

    expect(record).toMatchObject({
      id: 'profile-1',
      participantId: 'p1',
      participantName: 'Ana',
      explanationLevel: 'detallado',
      tone: 'friendly',
      observationCount: 0,
      levelObservationCount: 0,
      toneObservationCount: 0,
      confidence: 0.15,
      source: 'default',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(record.sync).toEqual({ revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false });
  });

  it('mergeObservation devuelve la MISMA referencia sin señal', () => {
    const record = makeRecord();
    const merged = mergeObservation(record, '¿qué hora es?', NOW, {
      explanationLevel: CONFIG.defaultExplanationLevel,
      tone: CONFIG.defaultTone,
    });
    expect(merged).toBe(record);
  });

  it('mergeObservation actualiza conteos, auto y confianza con señal de nivel', () => {
    const record = makeRecord();
    const merged = mergeObservation(record, 'explícamelo simple', NOW, {
      explanationLevel: CONFIG.defaultExplanationLevel,
      tone: CONFIG.defaultTone,
    });

    expect(merged).not.toBe(record);
    expect(merged.levelObservationCount).toBe(1);
    expect(merged.toneObservationCount).toBe(0);
    expect(merged.observationCount).toBe(1);
    expect(merged.autoExplanationLevel).toBe('simple');
    expect(merged.explanationLevel).toBe('simple');
    expect(merged.source).toBe('auto');
    expect(merged.confidence).toBeCloseTo(0.4); // 0.35 + 0.05
    expect(merged.lastObservation).toBe('explícamelo simple');
    expect(merged.updatedAt).toBe(NOW);
  });

  it('mergeObservation con señal de tono actualiza solo el tono', () => {
    const record = makeRecord();
    const merged = mergeObservation(record, 'trátame de usted', NOW, {
      explanationLevel: CONFIG.defaultExplanationLevel,
      tone: CONFIG.defaultTone,
    });

    expect(merged.toneObservationCount).toBe(1);
    expect(merged.levelObservationCount).toBe(0);
    expect(merged.autoTone).toBe('formal');
    expect(merged.tone).toBe('formal');
    expect(merged.source).toBe('auto');
  });

  it('mergeObservation conserva la prioridad manual frente al auto', () => {
    const record = makeRecord({
      manualExplanationLevel: 'avanzado',
      manualTone: 'formal',
      source: 'manual',
      confidence: 0.9,
    });
    const merged = mergeObservation(record, 'explícamelo simple', NOW, {
      explanationLevel: CONFIG.defaultExplanationLevel,
      tone: CONFIG.defaultTone,
    });

    expect(merged.autoExplanationLevel).toBe('simple');
    // Manual sigue ganando en el nivel resuelto.
    expect(merged.explanationLevel).toBe('avanzado');
    expect(merged.tone).toBe('formal');
  });
});

// ------------------------------------------------------------
// Servicio — ensure y setManual
// ------------------------------------------------------------
describe('communicationProfileService — ensure y setManual', () => {
  it('ensure crea un registro por defecto y reutiliza el existente', async () => {
    const svc = createService(db);

    const created = await svc.ensure('p1', 'Ana');
    expect(created).toMatchObject({
      participantId: 'p1',
      participantName: 'Ana',
      explanationLevel: 'detallado',
      tone: 'friendly',
      source: 'default',
    });

    const again = await svc.ensure('p1', 'Ana');
    expect(again.id).toBe(created.id);
    expect(await db.toArray()).toHaveLength(1);
    // ensure NO audita (solo lectura/creación de semilla).
    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('setManual fija nivel y tono con prioridad máxima y audita', async () => {
    const svc = createService(db);

    const updated = await svc.setManual('p1', { explanationLevel: 'simple', tone: 'formal' }, 'Ana');

    expect(updated).toMatchObject({
      id: 'profile-1',
      participantId: 'p1',
      participantName: 'Ana',
      manualExplanationLevel: 'simple',
      manualTone: 'formal',
      explanationLevel: 'simple',
      tone: 'formal',
      source: 'manual',
    });
    // setManual usa Math.max(1, observaciones) → base manual 0.9 + 0.05.
    expect(updated.confidence).toBeCloseTo(0.95);
    expect(updated.sync.revision).toBe(1);

    // Persistencia y auditoría.
    expect(await db.toArray()).toHaveLength(1);
    expect(addAuditLog).toHaveBeenCalledTimes(1);
    expect(addAuditLog).toHaveBeenCalledWith(
      'communicationProfile.setManual',
      'communicationProfile',
      'p1',
      null,
      expect.objectContaining({ manualExplanationLevel: 'simple', manualTone: 'formal' }),
      'communicationProfileService',
    );
  });

  it('setManual sobre registro existente hace put y sube la revisión sync', async () => {
    const seeded = createMapDb([makeRecord()]);
    const svc = createService(seeded);

    const updated = await svc.setManual('p1', { tone: 'casual' }, 'Ana');

    expect(updated.manualTone).toBe('casual');
    expect(updated.manualExplanationLevel).toBeUndefined();
    expect(updated.explanationLevel).toBe('detallado'); // sin manual de nivel → default
    expect(updated.tone).toBe('casual');
    expect(updated.sync.revision).toBe(2);
    expect(addAuditLog).toHaveBeenCalledWith(
      'communicationProfile.setManual',
      'communicationProfile',
      'p1',
      expect.objectContaining({ id: 'seed-profile' }),
      expect.objectContaining({ manualTone: 'casual' }),
      'communicationProfileService',
    );
  });

  it('setManual rechaza participante inválido', async () => {
    const svc = createService(db);
    await expect(svc.setManual('', { tone: 'casual' })).rejects.toThrow('invalid-input');
    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('setManual con parche vacío devuelve base sin persistir ni auditar', async () => {
    const svc = createService(db);
    const result = await svc.setManual('p1', {}, 'Ana');

    expect(result.source).toBe('default');
    expect(result.manualExplanationLevel).toBeUndefined();
    expect(await db.toArray()).toHaveLength(0);
    expect(addAuditLog).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
// Servicio — resetPerson y applyObservation
// ------------------------------------------------------------
describe('communicationProfileService — resetPerson y applyObservation', () => {
  it('resetPerson quita el manual y re-resuelve hacia auto o default', async () => {
    const seeded = createMapDb([
      makeRecord({
        id: 'seed-profile',
        manualExplanationLevel: 'simple',
        manualTone: 'formal',
        autoExplanationLevel: 'avanzado',
        autoTone: 'casual',
        explanationLevel: 'simple',
        tone: 'formal',
        source: 'manual',
        confidence: 0.9,
      }),
    ]);
    const svc = createService(seeded);

    const ok = await svc.resetPerson('p1');
    expect(ok).toBe(true);

    const rows = await seeded.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      manualExplanationLevel: undefined,
      manualTone: undefined,
      // Vuelve al auto (avanzado/casual), no al manual previo.
      explanationLevel: 'avanzado',
      tone: 'casual',
      source: 'auto',
      // 0 observaciones → base auto 0.35 + boost 0 = 0.35
      confidence: 0.35,
    });
    expect(rows[0].sync.revision).toBe(2);
    expect(addAuditLog).toHaveBeenCalledWith(
      'communicationProfile.reset',
      'communicationProfile',
      'p1',
      expect.objectContaining({ id: 'seed-profile', manualExplanationLevel: 'simple' }),
      expect.objectContaining({ manualExplanationLevel: undefined, explanationLevel: 'avanzado' }),
      'communicationProfileService',
    );
  });

  it('resetPerson cae a default cuando no hay auto ni manual', async () => {
    const seeded = createMapDb([makeRecord({ source: 'default' })]);
    const svc = createService(seeded);

    const ok = await svc.resetPerson('p1');
    expect(ok).toBe(true);

    const rows = await seeded.toArray();
    expect(rows[0].source).toBe('default');
    expect(rows[0].explanationLevel).toBe('detallado');
    expect(rows[0].tone).toBe('friendly');
  });

  it('resetPerson devuelve false sin registro', async () => {
    const svc = createService(db);
    expect(await svc.resetPerson('no-existe')).toBe(false);
    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('applyObservation persiste una fusión con señal y audita', async () => {
    const svc = createService(db);

    const merged = await svc.applyObservation('p1', 'explícamelo simple', 'Ana');

    expect(merged).not.toBeNull();
    expect(merged).toMatchObject({
      participantId: 'p1',
      participantName: 'Ana',
      autoExplanationLevel: 'simple',
      explanationLevel: 'simple',
      source: 'auto',
    });
    expect(await db.toArray()).toHaveLength(1);
    expect(addAuditLog).toHaveBeenCalledWith(
      'communicationProfile.observe',
      'communicationProfile',
      'p1',
      null,
      expect.objectContaining({ autoExplanationLevel: 'simple' }),
      'communicationProfileService',
    );
  });

  it('applyObservation devuelve null sin señal, sin id o con texto vacío (sin auditar)', async () => {
    const svc = createService(db);

    expect(await svc.applyObservation('p1', '¿qué hora es?', 'Ana')).toBeNull();
    expect(await svc.applyObservation('p1', '   ', 'Ana')).toBeNull();
    expect(await svc.applyObservation('', 'explícamelo simple', 'Ana')).toBeNull();

    expect(await db.toArray()).toHaveLength(0);
    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('applyObservation sobre registro manual conserva la prioridad manual', async () => {
    const seeded = createMapDb([
      makeRecord({
        id: 'seed-profile',
        manualExplanationLevel: 'avanzado',
        explanationLevel: 'avanzado',
        source: 'manual',
        confidence: 0.9,
      }),
    ]);
    const svc = createService(seeded);

    const merged = await svc.applyObservation('p1', 'explícamelo simple', 'Ana');

    expect(merged).not.toBeNull();
    expect(merged?.autoExplanationLevel).toBe('simple');
    expect(merged?.explanationLevel).toBe('avanzado'); // manual gana en el nivel resuelto
    // El registro anota la observación con fuente auto (contrato mergeObservation);
    // la prioridad manual se conserva en explanationLevel/tone.
    expect(merged?.source).toBe('auto');
  });
});

// ------------------------------------------------------------
// Servicio — resolveForTurn y list
// ------------------------------------------------------------
describe('communicationProfileService — resolveForTurn y list', () => {
  it('resolveForTurn devuelve default sin registro y NO persiste', async () => {
    const svc = createService(db);

    const resolved = await svc.resolveForTurn('p1');

    expect(resolved).toEqual({
      participantId: 'p1',
      explanationLevel: 'detallado',
      tone: 'friendly',
      ttsRate: 0.95,
      confidence: 0.15,
      source: 'default',
    });
    expect(await db.toArray()).toHaveLength(0);
    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('resolveForTurn prioriza manual > auto > default desde el registro', async () => {
    const seeded = createMapDb([
      makeRecord({
        id: 'seed-profile',
        manualExplanationLevel: 'simple',
        manualTone: 'formal',
        autoExplanationLevel: 'avanzado',
        autoTone: 'casual',
        explanationLevel: 'simple',
        tone: 'formal',
        source: 'manual',
        confidence: 0.9,
      }),
    ]);
    const svc = createService(seeded);

    const resolved = await svc.resolveForTurn('p1');
    expect(resolved).toEqual({
      participantId: 'p1',
      explanationLevel: 'simple',
      tone: 'formal',
      ttsRate: 1.05,
      confidence: 0.9,
      source: 'manual',
    });
  });

  it('resolveForTurn usa auto cuando no hay manual', async () => {
    const seeded = createMapDb([
      makeRecord({
        id: 'seed-profile',
        autoExplanationLevel: 'avanzado',
        autoTone: 'casual',
        explanationLevel: 'avanzado',
        tone: 'casual',
        source: 'auto',
        confidence: 0.4,
      }),
    ]);
    const svc = createService(seeded);

    const resolved = await svc.resolveForTurn('p1');
    expect(resolved.explanationLevel).toBe('avanzado');
    expect(resolved.tone).toBe('casual');
    expect(resolved.ttsRate).toBe(0.9);
    expect(resolved.source).toBe('auto');
  });

  it('list ordena por nombre con locale es y devuelve copias', async () => {
    const seeded = createMapDb([
      makeRecord({ id: 'seed-1', participantId: 'p2', participantName: 'Zoe' }),
      makeRecord({ id: 'seed-2', participantId: 'p1', participantName: 'Luis' }),
      makeRecord({ id: 'seed-3', participantId: 'p3', participantName: 'Ana' }),
    ]);
    const svc = createService(seeded);

    const all = await svc.list();
    expect(all.map((r) => r.participantName)).toEqual(['Ana', 'Luis', 'Zoe']);
    // Copias: mutar una no altera la tabla.
    all[0].tone = 'formal';
    const rows = await seeded.toArray();
    expect(rows.find((r) => r.participantName === 'Ana')?.tone).toBe('friendly');
  });
});
