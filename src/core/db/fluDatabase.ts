// ============================================================
// FLU OS3 — Dexie.js Database
// ============================================================
// Base de datos local con IndexedDB via Dexie.js.
// Cumple:
//   - Obligación #6: UUIDv4 en toda inserción
//   - Obligación #7: Tupla [revision, updated_at, deleted]
//   - Obligación #5: Log de auditoría
// ============================================================

import Dexie, { type EntityTable } from 'dexie';
import { v4 as uuidv4 } from 'uuid';

// -----------------------------------------------------------
// Sync Tuple — Obligación #7
// -----------------------------------------------------------
export interface SyncTuple {
    revision: number;
    updated_at: string; // ISO 8601 UTC
    deleted: boolean;
}

// -----------------------------------------------------------
// Audit Log Entry — Obligación #5
// -----------------------------------------------------------
export interface AuditLogEntry {
    id: string; // UUIDv4
    action: string;
    entity: string;
    entityId: string;
    previousValue: unknown;
    newValue: unknown;
    context: string;
    timestamp: string; // ISO 8601 UTC
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Conversation Row (persistente)
// -----------------------------------------------------------
export interface ConversationRow {
    id: string; // UUIDv4
    role: 'user' | 'flu' | 'system';
    text: string;
    speakerId: string;
    speakerName: string;
    sentiment?: string;
    timestamp: number;
    response?: string;
    meta?: Record<string, unknown> | null;
    signature?: number[] | null;
    phase?: string;
    navigation?: Record<string, unknown> | null;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Minute Record (persistente) — OS2 compatible
// -----------------------------------------------------------

/**
 * Snapshot del resumen de la minuta (OS2: summarySnapshot).
 * Coincide con createMinuteDraftFromSummary / AISummaryResult.
 */
export interface MinuteSummarySnapshot {
    titulo: string;
    participantes: string[];
    resumen: string;
    acuerdos: string[];
    pendientes: string[];
    siguientes_pasos: string[];
    tema_sesion: string;
}

/**
 * Registro de minuta persistente.
 * Sigue la nomenclatura exacta de OS2 normalizeMinuteKnowledgeRecord:
 *   - summarySnapshot: el contenido semántico de la minuta
 *   - historyCode: código de historial (YYMMDD-NN)
 *   - description: texto descriptivo (titulo)
 *   - minuteKey: clave única para dedup
 */
export interface MinuteRecord {
    id: string; // UUIDv4
    profileId: string;
    userId: string;
    minuteKey: string;
    historyCode: string;
    description: string;
    summarySnapshot: MinuteSummarySnapshot;
    sequence: number;
    createdAt: string; // ISO string
    updatedAt: string; // ISO string
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Voice Profile (persistente)
// -----------------------------------------------------------
export interface VoiceProfileRecord {
    id: string; // UUIDv4
    label: string;
    speakerId: string;
    signature: number[] | null;
    embedding: number[] | null;
    timestamp: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Session State (persistente)
// -----------------------------------------------------------
export interface SessionStateRecord {
    id: string; // UUIDv4
    key: string;
    value: unknown;
    timestamp: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Branding Config — Branding Inteligente por Temporalidad
// -----------------------------------------------------------

/**
 * Registro de configuración de branding persistente.
 * Almacena la temporada activa, paleta, decoraciones y eventos personalizados.
 */
export interface BrandingConfigRecord {
    id: string; // UUIDv4
    /** Clave de configuración: 'activeSeason', 'mode', 'birthday', 'customEvent', 'celebrateAchievements' */
    key: string;
    /** Valor de la configuración */
    value: string;
    /** Subvalor opcional (ej: variante de paleta 'infantil') */
    subvalue?: string;
    /** Metadatos adicionales (ej: { celebrandoA: "María", fecha: "2026-07-24" }) */
    meta?: Record<string, unknown>;
    /** Timestamp ISO 8601 */
    timestamp: string;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Database Class
// -----------------------------------------------------------
export class FluDatabase extends Dexie {
    auditLog!: EntityTable<AuditLogEntry, 'id'>;
    conversations!: EntityTable<ConversationRow, 'id'>;
    minutes!: EntityTable<MinuteRecord, 'id'>;
    voiceProfiles!: EntityTable<VoiceProfileRecord, 'id'>;
    sessionState!: EntityTable<SessionStateRecord, 'id'>;
    brandingConfig!: EntityTable<BrandingConfigRecord, 'id'>;

    constructor() {
        super('flu-os3');

        this.version(3).stores({
            auditLog: 'id, action, entity, timestamp, [entity+entityId]',
            conversations: 'id, role, timestamp, speakerId',
            minutes: 'id, timestamp, sequence',
            voiceProfiles: 'id, label, speakerId, timestamp',
            sessionState: 'id, key',
        });

        // v4: Agregar tabla brandingConfig para Branding Inteligente por Temporalidad
        this.version(4).stores({
            // Hereda todas las tablas de v3 (Dexie las preserva automáticamente)
            brandingConfig: 'id, key, timestamp',
        });

        this.auditLog = this.table('auditLog');
        this.conversations = this.table('conversations');
        this.minutes = this.table('minutes');
        this.voiceProfiles = this.table('voiceProfiles');
        this.sessionState = this.table('sessionState');
        this.brandingConfig = this.table('brandingConfig');
    }
}

// -----------------------------------------------------------
// Singleton
// -----------------------------------------------------------
export const fluDb = new FluDatabase();

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

/** Generar UUIDv4 — Obligación #6 */
export function newId(): string {
    return uuidv4();
}

/** Crear SyncTuple con valores iniciales — Obligación #7 */
export function newSyncTuple(): SyncTuple {
    return {
        revision: 1,
        updated_at: new Date().toISOString(),
        deleted: false,
    };
}

/** Incrementar revisión y actualizar timestamp */
export function bumpSync(tuple: SyncTuple): SyncTuple {
    return {
        ...tuple,
        revision: tuple.revision + 1,
        updated_at: new Date().toISOString(),
    };
}

// -----------------------------------------------------------
// Audit Log — Obligación #5
// -----------------------------------------------------------

/**
 * Registrar un cambio en el log de auditoría.
 * Toda modificación de configuración o datos debe pasar por aquí.
 */
export async function addAuditLog(
    action: string,
    entity: string,
    entityId: string,
    previousValue: unknown,
    newValue: unknown,
    context: string = '',
): Promise<AuditLogEntry> {
    const entry: AuditLogEntry = {
        id: newId(),
        action,
        entity,
        entityId,
        previousValue,
        newValue,
        context,
        timestamp: new Date().toISOString(),
        sync: newSyncTuple(),
    };
    await fluDb.auditLog.add(entry);
    return entry;
}

/**
 * Obtener entradas del log de auditoría.
 */
export async function getAuditLogs(limit: number = 100): Promise<AuditLogEntry[]> {
    return fluDb.auditLog
        .orderBy('timestamp')
        .reverse()
        .limit(limit)
        .toArray();
}

/**
 * Limpiar todos los logs de auditoría (OS2 parity: clearAuditLogs).
 */
export async function clearAuditLogs(): Promise<void> {
    await fluDb.auditLog.clear();
}
