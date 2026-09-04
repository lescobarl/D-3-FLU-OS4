// ============================================================
// Communication Profile Service — FASE P: Personalización profunda por persona
// ------------------------------------------------------------
// Ajusta el nivel de explicación y el tono de FLU según cada persona.
//   - Señales en el lenguaje (regex puras, es/en) → nivel + tono (auto).
//   - Preferencias declaradas manualmente → prioridad máxima.
//   - Resolución por turno: manual > auto > default (desde config).
// Cumple:
//   - Regla #1: NO HARDCODE — valores por defecto y TTS desde config
//   - Regla de oro: funciones puras y deterministas (helpers exportados)
//   - Obligación #1: Inyección de Dependencias { db, config, now, newId }
//   - Obligación #5: log de auditoría en cada mutación
//   - Obligación #6/#7: UUIDv4 + tupla Sync
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import {
  addAuditLog,
  type CommunicationProfileRecord,
  type ExplanationLevel,
  type SyncTuple,
} from '../db/fluDatabase';
import type { PersonalityTone } from '../../lib/discourseMarkers';

// ------------------------------------------------------------
// Re-export del tipo de registro (fuente única de verdad — DB)
// ------------------------------------------------------------
export type { CommunicationProfileRecord, ExplanationLevel } from '../db/fluDatabase';
export type { PersonalityTone } from '../../lib/discourseMarkers';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

/** Niveles de explicación disponibles (UI y resolución). */
export const EXPLANATION_LEVELS: readonly ExplanationLevel[] = ['simple', 'detallado', 'avanzado'];

/** Tonos de comunicación disponibles (UI y resolución). */
export const TONE_OPTIONS: readonly PersonalityTone[] = [
  'formal',
  'casual',
  'friendly',
  'professional',
  'energetic',
  'calm',
];

/** Configuración por defecto del perfil de comunicación (sin hardcode). */
export interface CommunicationProfileConfig {
  /** Tono por defecto cuando no hay observaciones ni manual. */
  defaultTone: string;
  /** Nivel de explicación por defecto cuando no hay observaciones ni manual. */
  defaultExplanationLevel: ExplanationLevel;
  /** Velocidad TTS por nivel de explicación (multiplicador de rate). */
  ttsRateByLevel: Record<ExplanationLevel, number>;
}

/** Interfaz mínima de la tabla `communicationProfiles` (DI). */
export interface CommunicationProfilesDb {
  add(record: CommunicationProfileRecord): Promise<unknown>;
  put(record: CommunicationProfileRecord): Promise<unknown>;
  delete(id: string): Promise<void>;
  getByParticipant(participantId: string): Promise<CommunicationProfileRecord | undefined>;
  toArray(): Promise<CommunicationProfileRecord[]>;
}

export interface CommunicationProfileServiceOptions {
  db: CommunicationProfilesDb;
  config: CommunicationProfileConfig;
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Generador de id (por defecto: uuid v4). */
  newId?: () => string;
}

/** Parche manual del perfil (al menos un campo). */
export interface ManualProfilePatch {
  explanationLevel?: ExplanationLevel;
  tone?: PersonalityTone;
}

/** Perfil resuelto para un turno de conversación (lo que consume FLU). */
export interface ResolvedCommunicationProfile {
  participantId: string;
  explanationLevel: ExplanationLevel;
  tone: string;
  ttsRate: number;
  confidence: number;
  source: CommunicationProfileRecord['source'];
}

// ------------------------------------------------------------
// Patrones de señal (es/en) — puros, sin URL, sin hardcode
// ------------------------------------------------------------

/** Palabras/señales que indican el nivel de explicación deseado. */
const EXPLANATION_LEVEL_PATTERNS: Record<ExplanationLevel, RegExp[]> = {
  simple: [
    /(?:corto|corta|simple|breve|resumido|resumida|conciso|concisa|resumen)\b/i,
    /(?:en\s+una\s+(?:frase|palabra|linea)|no\s+(?:tan\s+)?(?:largo|larga|extenso|extensa)|explica\s+(?:poquito|poco|menos))\b/i,
    /(?:short|simple|brief|quick|concise|tldr|tl;dr|in\s+short|summarize|summary)\b/i,
    /(?:not\s+(?:too\s+)?(?:long|much)|in\s+one\s+(?:sentence|line|word)|explain\s+less)\b/i,
  ],
  detallado: [
    /(?:detallado|detallada|detalle|a\s+fondo|paso\s+a\s+paso|amplio|amplia|extenso|extensa)\b/i,
    /(?:explica\s+(?:mas|más|mejor)|(?:mas|más)\s+contexto|con\s+calma|sin\s+prisas|con\s+ejemplos)\b/i,
    /(?:detailed|in\s+detail|step\s+by\s+step|thorough|in-depth|explain\s+(?:more|further)|more\s+context|with\s+examples)\b/i,
  ],
  avanzado: [
    /(?:tecnico|técnico|tecnica|técnica|avanzado|avanzada|experto|experta|profundo|profunda|jerga)\b/i,
    /(?:detalles\s+tecnicos|detalles\s+técnicos|nivel\s+tecnico|nivel\s+técnico|por\s+dentro|bajo\s+el\s+capo)\b/i,
    /(?:technical|advanced|expert|in-depth\s+technical|jargon|under\s+the\s+hood|internals)\b/i,
  ],
};

/** Palabras/señales que indican el tono de comunicación deseado. */
const TONE_PATTERNS: Record<PersonalityTone, RegExp[]> = {
  formal: [
    /(?:tono\s+formal|formalmente|de\s+forma\s+formal|con\s+respeto|tr[áa]tame\s+de\s+usted)\b/i,
    /(?:formal|serio|seria|sobrio|sobria)\b/i,
    /(?:formal\s+tone|be\s+formal|speak\s+formally)\b/i,
  ],
  casual: [
    /(?:tono\s+casual|casualmente|de\s+forma\s+casual|sin\s+tanta\s+formalidad|relajado|relajada|natural)\b/i,
    /(?:casual|informal|chill|natural)\b/i,
    /(?:casual\s+tone|be\s+casual|keep\s+it\s+chill)\b/i,
  ],
  friendly: [
    /(?:tono\s+amigable|amigable|amable|cercano|cercana|simpat\w*|como\s+amigo|como\s+amiga)\b/i,
    /(?:friendly|warm|kind|like\s+a\s+friend)\b/i,
  ],
  professional: [
    /(?:tono\s+profesional|profesional|de\s+trabajo|como\s+en\s+la\s+oficina|pro)\b/i,
    /(?:professional|business\s+tone|work-appropriate)\b/i,
  ],
  energetic: [
    /(?:tono\s+en\s+ergico|tono\s+energético|energico|enérgico|animado|animada|con\s+energia|con\s+energía|entusiasta|emocionante)\b/i,
    /(?:energetic|enthusiastic|excited|pumped\s+up)\b/i,
  ],
  calm: [
    /(?:tono\s+calmado|tono\s+calmo|calmado|calmada|tranquilo|tranquila|pausado|pausada|relajante|sereno|serena)\b/i,
    /(?:calm|peaceful|relaxed|soothing|gentle)\b/i,
  ],
};

// ------------------------------------------------------------
// Detección pura
// ------------------------------------------------------------

/**
 * Detecta el nivel de explicación deseado a partir del texto (es/en).
 * Devuelve null si no hay señal.
 */
export function detectExplanationLevel(text: string): ExplanationLevel | null {
  const entries = Object.entries(EXPLANATION_LEVEL_PATTERNS) as Array<[ExplanationLevel, RegExp[]]>;
  for (const [level, patterns] of entries) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return level;
    }
  }
  return null;
}

/**
 * Detecta el tono deseado a partir del texto (es/en).
 * Devuelve null si no hay señal.
 */
export function detectToneFromText(text: string): PersonalityTone | null {
  const entries = Object.entries(TONE_PATTERNS) as Array<[PersonalityTone, RegExp[]]>;
  for (const [tone, patterns] of entries) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return tone;
    }
  }
  return null;
}

/**
 * Confianza acumulada del perfil según fuente y conteo de observaciones.
 * - manual: base alta (0.9) — decisión explícita del cuidador.
 * - auto: base media (0.35) + boost por repetición.
 * - default: base baja (0.15).
 */
export function computeProfileConfidence(
  observationCount: number,
  source: CommunicationProfileRecord['source'],
): number {
  let base: number;
  switch (source) {
    case 'manual':
      base = 0.9;
      break;
    case 'auto':
      base = 0.35;
      break;
    case 'default':
      base = 0.15;
      break;
  }
  const repetitionBoost = Math.min(0.3, observationCount * 0.05);
  return Math.min(1, base + repetitionBoost);
}

/**
 * Nivel de explicación resuelto: manual > auto > fallback.
 */
export function resolveExplanationLevel(
  record: Pick<CommunicationProfileRecord, 'manualExplanationLevel' | 'autoExplanationLevel'>,
  fallback: ExplanationLevel,
): ExplanationLevel {
  if (record.manualExplanationLevel) return record.manualExplanationLevel;
  if (record.autoExplanationLevel) return record.autoExplanationLevel;
  return fallback;
}

/**
 * Tono resuelto: manual > auto > fallback.
 */
export function resolveTone(
  record: Pick<CommunicationProfileRecord, 'manualTone' | 'autoTone'>,
  fallback: string,
): string {
  if (record.manualTone) return record.manualTone;
  if (record.autoTone) return record.autoTone;
  return fallback;
}

/**
 * Velocidad TTS para un nivel de explicación (desde config, sin hardcode).
 */
export function ttsRateForLevel(
  level: ExplanationLevel,
  config: Pick<CommunicationProfileConfig, 'ttsRateByLevel'>,
): number {
  const rate = config.ttsRateByLevel[level];
  return typeof rate === 'number' ? rate : 1;
}

/**
 * Registro por defecto (sin observaciones) para un participante.
 */
export function defaultRecord(
  participantId: string,
  participantName: string | undefined,
  config: CommunicationProfileConfig,
  now: number,
  id: string = uuidv4(),
): CommunicationProfileRecord {
  return {
    id,
    participantId,
    participantName,
    explanationLevel: config.defaultExplanationLevel,
    tone: config.defaultTone,
    observationCount: 0,
    levelObservationCount: 0,
    toneObservationCount: 0,
    confidence: computeProfileConfidence(0, 'default'),
    source: 'default',
    createdAt: now,
    updatedAt: now,
    sync: { revision: 1, updated_at: new Date(now).toISOString(), deleted: false },
  };
}

/**
 * Fusiona una observación (texto) en el perfil. Devuelve el MISMO objeto
 * (referencia) si no hay señal detectada; en caso contrario devuelve una
 * copia actualizada con el nivel/tono auto derivados y confianza recalculada.
 */
export function mergeObservation(
  record: CommunicationProfileRecord,
  text: string,
  now: number,
  defaults: { explanationLevel: ExplanationLevel; tone: string },
): CommunicationProfileRecord {
  const level = detectExplanationLevel(text);
  const tone = detectToneFromText(text);
  if (!level && !tone) return record;

  const next: CommunicationProfileRecord = {
    ...record,
    levelObservationCount: record.levelObservationCount + (level ? 1 : 0),
    toneObservationCount: record.toneObservationCount + (tone ? 1 : 0),
    lastObservation: text,
    updatedAt: now,
  };
  next.observationCount = next.levelObservationCount + next.toneObservationCount;
  if (level) next.autoExplanationLevel = level;
  if (tone) next.autoTone = tone;
  next.explanationLevel = resolveExplanationLevel(next, defaults.explanationLevel);
  next.tone = resolveTone(next, defaults.tone);
  next.source = 'auto';
  next.confidence = computeProfileConfidence(next.observationCount, 'auto');
  return next;
}

// ------------------------------------------------------------
// Service (DI)
// ------------------------------------------------------------

export function createCommunicationProfileService({
  db,
  config,
  now = () => Date.now(),
  newId = uuidv4,
}: CommunicationProfileServiceOptions) {
  const timestamp = (): number => now();

  const toRecord = (row: CommunicationProfileRecord): CommunicationProfileRecord => ({ ...row });

  const buildSync = (previous?: SyncTuple): SyncTuple => {
    if (!previous) {
      return { revision: 1, updated_at: new Date(timestamp()).toISOString(), deleted: false };
    }
    return {
      revision: previous.revision + 1,
      updated_at: new Date(timestamp()).toISOString(),
      deleted: previous.deleted,
    };
  };

  const getForPerson = async (participantId: string): Promise<CommunicationProfileRecord | undefined> => {
    if (!participantId) return undefined;
    const row = await db.getByParticipant(participantId);
    return row ? toRecord(row) : undefined;
  };

  const ensure = async (
    participantId: string,
    participantName?: string,
  ): Promise<CommunicationProfileRecord> => {
    const existing = await getForPerson(participantId);
    if (existing) return existing;
    const record = defaultRecord(participantId, participantName, config, timestamp(), newId());
    await db.add(record);
    return toRecord(record);
  };

  /**
   * Fija manualmente el nivel de explicación y/o el tono de una persona
   * (prioridad máxima). Crea el registro si no existe.
   */
  const setManual = async (
    participantId: string,
    patch: ManualProfilePatch,
    participantName?: string,
  ): Promise<CommunicationProfileRecord> => {
    if (!participantId) throw new Error('invalid-input');
    const existing = await getForPerson(participantId);
    const base = existing
      ? { ...existing }
      : defaultRecord(participantId, participantName, config, timestamp(), newId());

    if (patch.explanationLevel === undefined && patch.tone === undefined) {
      return toRecord(base);
    }

    const previous = existing ? { ...existing } : undefined;
    const manualExplanationLevel = patch.explanationLevel ?? base.manualExplanationLevel;
    const manualTone = patch.tone ?? base.manualTone;

    const updated: CommunicationProfileRecord = {
      ...base,
      participantName: participantName ?? base.participantName,
      manualExplanationLevel,
      manualTone,
      explanationLevel: resolveExplanationLevel(
        { ...base, manualExplanationLevel },
        config.defaultExplanationLevel,
      ),
      tone: resolveTone({ ...base, manualTone }, config.defaultTone),
      source: 'manual',
      confidence: computeProfileConfidence(Math.max(1, base.observationCount), 'manual'),
      updatedAt: timestamp(),
      // Creación nueva inicia en revisión 1 (igual que ensure); actualización sube.
      sync: existing ? buildSync(base.sync) : buildSync(),
    };

    if (existing) await db.put(updated);
    else await db.add(updated);
    await addAuditLog(
      'communicationProfile.setManual',
      'communicationProfile',
      participantId,
      previous ?? null,
      updated,
      'communicationProfileService',
    );
    return toRecord(updated);
  };

  /**
   * Quita las preferencias manuales de una persona y re-resuelve
   * hacia auto (si hay observaciones) o default.
   */
  const resetPerson = async (participantId: string): Promise<boolean> => {
    const row = await getForPerson(participantId);
    if (!row) return false;
    const previous = { ...row };
    const hasAuto = Boolean(row.autoExplanationLevel || row.autoTone);
    const updated: CommunicationProfileRecord = {
      ...row,
      manualExplanationLevel: undefined,
      manualTone: undefined,
      source: hasAuto ? 'auto' : 'default',
      confidence: computeProfileConfidence(row.observationCount, hasAuto ? 'auto' : 'default'),
      updatedAt: timestamp(),
      sync: buildSync(row.sync),
    };
    // Resolución sobre el registro YA sin manual (no sobre el original con manual).
    updated.explanationLevel = resolveExplanationLevel(updated, config.defaultExplanationLevel);
    updated.tone = resolveTone(updated, config.defaultTone);
    await db.put(updated);
    await addAuditLog(
      'communicationProfile.reset',
      'communicationProfile',
      participantId,
      previous,
      updated,
      'communicationProfileService',
    );
    return true;
  };

  /**
   * Aplica una observación (texto de la persona) al perfil. Devuelve null si
   * no hay señal o no hay participante; en caso contrario persiste la fusión.
   */
  const applyObservation = async (
    participantId: string,
    text: string,
    participantName?: string,
  ): Promise<CommunicationProfileRecord | null> => {
    if (!participantId || !text || !text.trim()) return null;
    const existing = await getForPerson(participantId);
    const base = existing
      ? { ...existing }
      : defaultRecord(participantId, participantName, config, timestamp(), newId());
    const merged = mergeObservation(base, text, timestamp(), {
      explanationLevel: config.defaultExplanationLevel,
      tone: config.defaultTone,
    });
    if (merged === base) return null;

    const previous = existing ? { ...existing } : undefined;
    if (existing) await db.put(merged);
    else await db.add(merged);
    await addAuditLog(
      'communicationProfile.observe',
      'communicationProfile',
      participantId,
      previous ?? null,
      merged,
      'communicationProfileService',
    );
    return toRecord(merged);
  };

  /**
   * Perfil resuelto para un turno: manual > auto > default. No persiste.
   */
  const resolveForTurn = async (participantId: string): Promise<ResolvedCommunicationProfile> => {
    const row = await getForPerson(participantId);
    if (!row) {
      return {
        participantId,
        explanationLevel: config.defaultExplanationLevel,
        tone: config.defaultTone,
        ttsRate: ttsRateForLevel(config.defaultExplanationLevel, config),
        confidence: computeProfileConfidence(0, 'default'),
        source: 'default',
      };
    }
    const level = resolveExplanationLevel(row, config.defaultExplanationLevel);
    return {
      participantId,
      explanationLevel: level,
      tone: resolveTone(row, config.defaultTone),
      ttsRate: ttsRateForLevel(level, config),
      confidence: row.confidence,
      source: row.source,
    };
  };

  /** Todos los perfiles ordenados por nombre de participante. */
  const list = async (): Promise<CommunicationProfileRecord[]> => {
    const all = await db.toArray();
    return all
      .slice()
      .sort((a, b) => (a.participantName || '').localeCompare(b.participantName || '', 'es'))
      .map(toRecord);
  };

  return {
    getForPerson,
    ensure,
    setManual,
    resetPerson,
    applyObservation,
    resolveForTurn,
    list,
  };
}

export type CommunicationProfileService = ReturnType<typeof createCommunicationProfileService>;
