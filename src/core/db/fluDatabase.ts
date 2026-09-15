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
import type { EnvironmentDefinition } from '../environments/environmentRegistry';
import type { PaletteDefinition } from '../branding/seasonalPalettes';
import type { SearchSite } from '../search/searchSiteTypes';
import type { ReminderRepeat, TemporalItemRecord } from '../temporal/temporalTypes';
import type { AgendaItem } from '../agenda/agendaModel';
import type { ConversationEntry } from '../../types/bridge';

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
    meta?: ConversationEntry['meta'] | null;
    signature?: number[] | null;
    phase?: string;
    navigation?: Record<string, unknown> | null;
    /** Usuario (participante) dueño de la fila: aísla conversaciones por usuario. */
    participantId?: string;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Document Record (historial de documentos/imágenes generados o cargados)
// -----------------------------------------------------------
export interface DocumentRecord {
    id: string; // UUIDv4
    /** 'generated' (IA: pdf/video/imagen) | 'uploaded' (archivo del usuario). */
    kind: 'generated' | 'uploaded';
    /** Formato/origen: 'pdf' | 'video' | 'image' | 'docx' | 'txt' | … */
    formato: string;
    titulo: string;
    nombre: string;
    mime?: string;
    tamaño?: number;
    /** URL/ref (p. ej. mp4 remoto) o fragmento de contenido. */
    ref?: string;
    contenido?: string;
    /** Usuario dueño (aislamiento por usuario). */
    personId?: string;
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Minute Record (persistente) — OS2 compatible
// -----------------------------------------------------------
/**
 * Snapshot del resumen de la minuta (OS2: summarySnapshot).
 * Coincide con createMinuteDraftFromSummary / AISummaryResult.
 */
export type KnowledgeKind = 'minuta' | 'conversacion' | 'diario';

export interface MinuteSummarySnapshot {
    titulo: string;
    participantes: string[];
    resumen: string;
    acuerdos: string[];
    pendientes: string[];
    siguientes_pasos: string[];
    tema_sesion: string;
    /**
     * Tipo de registro de conocimiento (Paso 6 — memoria generalizada).
     * Opcional para compatibilidad retroactiva: los registros previos sin
     * `kind` se tratan como 'minuta'.
     */
    kind?: KnowledgeKind;
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
// Reminder Record (persistente) — Memoria y recordatorios (Fase 2)
// -----------------------------------------------------------

export type ReminderStatus = 'pending' | 'done' | 'dismissed';

/** Registro persistente de un recordatorio. */
export interface ReminderRecord {
    id: string; // UUIDv4
    text: string;
    /** Vencimiento en ms desde epoch (UTC). Determinista para el scheduler. */
    dueAt: number;
    /** Opcional: persona/participante al que va dirigido (B4). */
    personId?: string;
    personName?: string;
    /** Recurrencia opcional (motor temporal genérico): once/daily/weekdays/interval. */
    repeat?: ReminderRepeat;
    category: string;
    status: ReminderStatus;
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Shopping Item Record (persistente) — Lista de compras (Fase 2)
// -----------------------------------------------------------

/** Registro persistente de un ítem de compra. */
export interface ShoppingItemRecord {
    id: string; // UUIDv4
    label: string;
    checked: boolean;
    /** Persona que registró el ítem (opcional, multi-usuario). */
    personId?: string;
    personName?: string;
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Note Record (persistente) — Listado de notas (Pizarrón consolidado)
// -----------------------------------------------------------

/**
 * Registro persistente de una nota del pizarrón consolidado. Reemplaza la
 * lista de compras como "listado de notas" (recorte de alcance del pizarrón).
 * - `label`: texto de la nota.
 * - `done`: estado completado/pendiente (paridad con `checked` de shopping).
 * - `personId`/`personName`: persona que registró la nota (multi-usuario).
 */
export interface NoteRecord {
    id: string; // UUIDv4
    label: string;
    done: boolean;
    /** Persona que registró la nota (opcional, multi-usuario). */
    personId?: string;
    personName?: string;
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Participant Record (persistente) — Multi-usuario (Fase 3, A3/A4/A5/B9)
// -----------------------------------------------------------

/**
 * Participante registrado del hogar/equipo. Agrupa la identidad de voz
 * (speakerLabel de la diarización A3), el perfil de asistente (profileId A4),
 * preferencias de TTS (A5) y datos de cumpleaños (B9).
 */
export interface ParticipantRecord {
    id: string; // UUIDv4
    name: string;
    /** Rol libre: 'adulto' | 'niño' | 'invitado' u otro texto. */
    role?: string;
    /** Fecha de nacimiento 'YYYY-MM-DD' para B9 (cumpleaños). */
    birthday?: string;
    /** Etiqueta de hablante de la diarización (A3). */
    speakerLabel?: string;
    /** Id del perfil de asistente FLU_PROFILES (A4). */
    profileId?: string;
    /** Voz TTS personalizada (A5). */
    ttsVoiceURI?: string;
    ttsVoiceName?: string;
    ttsRate?: number;
    ttsPitch?: number;
    /** Estilo de participación derivado (participantProfiles). */
    participationStyle?: string;
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Materia Gris Record (persistente) — F5 gamificación
// -----------------------------------------------------------

/** Registro de puntos de "materia gris" otorgados a un participante (F5). */
export interface MateriaGrisRecord {
    id: string; // UUIDv4
    participantId: string;
    participantName?: string;
    /** Acción que otorgó los puntos ('recordatorio_completado', 'cuento', ...). */
    action: string;
    points: number;
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Goal Record (persistente) — Hábitos y metas (Fase 4, Módulo G)
// -----------------------------------------------------------

export type GoalStatus = 'active' | 'done' | 'paused' | 'archived';

/**
 * Registro persistente de una meta o hábito por participante.
 * - `targetDays`: días objetivo para un hábito (base de la racha/progreso).
 * - `unit`: unidad legible del progreso (p. ej. 'días').
 */
export interface GoalRecord {
    id: string; // UUIDv4
    participantId: string;
    participantName?: string;
    title: string;
    description?: string;
    category: string;
    status: GoalStatus;
    targetDays?: number;
    unit?: string;
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Goal Check-In Record (persistente) — Hábitos y metas (Fase 4, Módulo G)
// -----------------------------------------------------------

/**
 * Registro persistente de un check-in diario de una meta/hábito.
 * `date` es la clave de día local 'YYYY-MM-DD' (un único check-in por meta y día).
 */
export interface GoalCheckInRecord {
    id: string; // UUIDv4
    goalId: string;
    participantId: string;
    date: string; // 'YYYY-MM-DD' (día local de referencia)
    done: boolean;
    note?: string;
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Mood Record (persistente) — Bienestar/Ánimo (Fase 5, Módulo H)
// -----------------------------------------------------------

/**
 * Registro persistente de un registro diario de ánimo por participante.
 * `date` es la clave de día local 'YYYY-MM-DD' (un único registro por
 * participante y día; si se vuelve a registrar el mismo día se actualiza).
 * `mood` es el ánimo en la escala 1..scaleMax (configurable en FLU_CONFIG).
 */
export interface MoodRecord {
    id: string; // UUIDv4
    participantId: string;
    participantName?: string;
    date: string; // 'YYYY-MM-DD' (día local de referencia)
    mood: number; // escala 1..scaleMax
    note?: string;
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Contact Record (persistente) — Contactos (Fase 6, Módulo I)
// -----------------------------------------------------------

/**
 * Registro persistente de un contacto de la agenda.
 * - `birthday`: cumpleaños en clave 'YYYY-MM-DD' (vinculación B9).
 * - `participantId`/`participantName`: vínculo opcional con un participante
 *   del registro multiusuario para asociar el cumpleaños de una persona.
 * - `favorite`: marca para destacar y ordenar los contactos favoritos.
 */
export interface ContactRecord {
    id: string; // UUIDv4
    name: string;
    phone?: string;
    email?: string;
    relationship?: string;
    birthday?: string; // 'YYYY-MM-DD'
    participantId?: string;
    participantName?: string;
    notes?: string;
    favorite?: boolean;
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Diary Entry Record (persistente) — Diario personal (Fase 6, Módulo J)
// -----------------------------------------------------------

/**
 * Registro persistente de una entrada del diario personal.
 * `date` es la clave de día local 'YYYY-MM-DD' (puede haber varias
 * entradas por día). `content` es el texto de la entrada (notas/voz).
 * `mood` es un ánimo opcional asociado (escala 1..scaleMax).
 */
export interface DiaryEntryRecord {
    id: string; // UUIDv4
    date: string; // 'YYYY-MM-DD' (día local de referencia)
    title?: string;
    content: string;
    mood?: number; // ánimo opcional asociado a la entrada
    participantId?: string;
    participantName?: string;
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Ambiente Catalog Record (persistente) — Catálogo dinámico (1A)
// -----------------------------------------------------------
export interface AmbienteCatalogRecord {
    id: string; // UUIDv4
    /** Nombre legible denormalizado para indexación (idéntico a data.nombre). */
    nombre: string;
    /** Definición completa del ambiente (EnvironmentDefinition serializable). */
    data: EnvironmentDefinition;
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Palette Catalog Record (persistente) — Catálogo dinámico (1B)
// -----------------------------------------------------------
export interface PaletaCatalogRecord {
    id: string; // UUIDv4
    /** Nombre legible denormalizado para indexación (idéntico a data.name). */
    name: string;
    /** Definición completa de la paleta (PaletteDefinition serializable). */
    data: PaletteDefinition;
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Search Site Catalog Record (persistente) — Catálogo de sitios (F2)
// -----------------------------------------------------------
export interface SearchSiteRecord {
    id: string; // UUIDv4
    /** Dominio canónico denormalizado para indexación (idéntico a data.dominio). */
    dominio: string;
    /** Definición completa del sitio (SearchSite serializable). */
    data: SearchSite;
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Horario Record (persistente) — Clases en el Pizarrón
// -----------------------------------------------------------

/**
 * Registro persistente de una entrada del horario (GENÉRICO — no atado a
 * "clases escolares" ni a un carnet fijo). Puede representar cualquier tipo
 * de agenda recurrente: horario escolar, carnet médico (IMSS u otro),
 * horario laboral, rutina de gimnasio, etc.
 * - `tipo`: etiqueta libre del tipo de horario (p. ej. 'escuela', 'medico',
 *   'trabajo'). Opcional y NO hardcodeado (Rule #1).
 * - `materia`: título legible de la entrada (materia, consulta, actividad…).
 * - `aula`: lugar opcional (aula, consultorio, oficina, sede…).
 * - `dia`: 1=Lunes ... 7=Domingo (ISO 8601).
 * - `inicio`/`fin`: hora local 'HH:MM' de 24 h.
 * - `color`: token opcional (m1..m6) definido en FLU_CONFIG.horario.colores.
 * - `reminders`: ids de recordatorios vinculados (opcional, FASE D).
 */
export interface HorarioRecord {
    id: string; // UUIDv4
    /** Etiqueta libre del tipo de horario (escuela, medico, trabajo…). Opcional. */
    tipo?: string;
    /** Título legible de la entrada (materia, consulta, actividad…). */
    materia: string;
    dia: number; // 1-7 (1=Lunes)
    inicio: string; // 'HH:MM' 24h local
    fin: string; // 'HH:MM' 24h local
    aula?: string;
    color?: string;
    reminders?: string[];
    /** Usuario dueño de la entrada (aislamiento por usuario). */
    personId?: string;
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

// -----------------------------------------------------------
// Communication Profile Record (persistente) — FASE P: Personalización profunda por persona
// -----------------------------------------------------------

/** Nivel de explicación (profundidad pedagógica) que FLU usa por persona. */
export type ExplanationLevel = 'simple' | 'detallado' | 'avanzado';

/**
 * Registro persistente del perfil de comunicación de una persona (FASE P).
 * Guarda el nivel de explicación y el tono preferidos por cada participante,
 * derivados de observaciones automáticas o fijados manualmente.
 * - `explanationLevel`/`tone`: valores resueltos (manual si existe, si no auto, si no default).
 * - `manualExplanationLevel`/`manualTone`: preferencias declaradas (prioridad máxima).
 */
export interface CommunicationProfileRecord {
    id: string; // UUIDv4
    /** Participante al que pertenece el perfil. */
    participantId: string;
    /** Nombre del participante denormalizado (legible/auditoría). */
    participantName?: string;
    /** Nivel de explicación resuelto (manual si existe, si no auto, si no default). */
    explanationLevel: ExplanationLevel;
    /** Tono de comunicación resuelto (manual si existe, si no auto, si no default). */
    tone: string;
    /** Nivel de explicación derivado automáticamente de observaciones. */
    autoExplanationLevel?: ExplanationLevel;
    /** Tono derivado automáticamente de observaciones. */
    autoTone?: string;
    /** Preferencia manual de nivel de explicación (tiene prioridad). */
    manualExplanationLevel?: ExplanationLevel;
    /** Preferencia manual de tono (tiene prioridad). */
    manualTone?: string;
    /** Conteo total de observaciones aplicadas. */
    observationCount: number;
    /** Conteo de observaciones de nivel de explicación. */
    levelObservationCount: number;
    /** Conteo de observaciones de tono. */
    toneObservationCount: number;
    /** Confianza acumulada (0..1). */
    confidence: number;
    /** Última observación aplicada (diagnóstico). */
    lastObservation?: string;
    /** Fuente de la última actualización: 'manual' | 'auto' | 'default'. */
    source: 'manual' | 'auto' | 'default';
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

/**
 * Estado de onboarding por usuario (multiusuario — Fase 3).
 * Cada participante (papá/mamá/hijo) tiene su propio estado de primera
 * configuración. El id ES el participantId (o 'default' para el estado
 * legacy basado en localStorage).
 */
export interface OnboardingStateRecord {
    /** id = participantId (o 'default' para el estado legacy). */
    id: string;
    /** Índice del paso actual dentro de onboardingFlow. */
    stepIndex: number;
    /** true cuando el usuario completó la primera configuración. */
    completed: boolean;
    /** Valores capturados (ej. { name: 'Ana' }). */
    captured: Record<string, string>;
    /** Marca temporal de inicio del onboarding. */
    startedAt: number;
    /** Última actualización. */
    updatedAt: number;
    sync: SyncTuple;
}

/**
 * Perfil del navegador curado por participante (Punto 2).
 * Define cómo se comporta el Pizarrón-navegador para cada persona:
 * categorías curadas, sitios permitidos (allowlist), nivel de lectura,
 * idioma, supervisión y tiles de inicio. El id ES el participantId
 * (o 'default' para el modo legado de un solo usuario).
 */
export interface BrowserProfileRecord {
    /** id = participantId (o 'default' para legado). */
    id: string;
    /** Participante al que pertenece el perfil. */
    participantId: string;
    /** Nombre del participante denormalizado (legible/auditoría). */
    participantName?: string;
    /** Categorías curadas habilitadas (claves del catálogo en config). */
    categories: string[];
    /** Dominios/URLs aprobados (navegación curada). */
    allowlist: string[];
    /** Nivel de lectura: 'simple' | 'detallado' | 'avanzado'. */
    readingLevel: 'simple' | 'detallado' | 'avanzado';
    /** Idioma preferido. */
    language: 'es' | 'en' | 'both';
    /** Orden de tiles de inicio (claves de categoría). */
    homeTiles: string[];
    createdAt: number;
    updatedAt: number;
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
    reminders!: EntityTable<ReminderRecord, 'id'>;
    shoppingItems!: EntityTable<ShoppingItemRecord, 'id'>;
    participants!: EntityTable<ParticipantRecord, 'id'>;
    materiaGris!: EntityTable<MateriaGrisRecord, 'id'>;
    goals!: EntityTable<GoalRecord, 'id'>;
    goalCheckIns!: EntityTable<GoalCheckInRecord, 'id'>;
    moodCheckIns!: EntityTable<MoodRecord, 'id'>;
    contacts!: EntityTable<ContactRecord, 'id'>;
    diaryEntries!: EntityTable<DiaryEntryRecord, 'id'>;
    ambientes!: EntityTable<AmbienteCatalogRecord, 'id'>;
    paletas!: EntityTable<PaletaCatalogRecord, 'id'>;
    horario!: EntityTable<HorarioRecord, 'id'>;
    temporalItems!: EntityTable<TemporalItemRecord, 'id'>;
    communicationProfiles!: EntityTable<CommunicationProfileRecord, 'id'>;
    onboardingStates!: EntityTable<OnboardingStateRecord, 'id'>;
    browserProfiles!: EntityTable<BrowserProfileRecord, 'id'>;
    searchSites!: EntityTable<SearchSiteRecord, 'id'>;
    notes!: EntityTable<NoteRecord, 'id'>;
    documents!: EntityTable<DocumentRecord, 'id'>;
    agenda!: EntityTable<AgendaItem, 'id'>;

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

        // v5: Agregar tablas de Fase 2 — Memoria y recordatorios (B1/B4/B10)
        this.version(5).stores({
            reminders: 'id, status, dueAt, personId, createdAt',
            shoppingItems: 'id, checked, personId, createdAt',
        });

        // v6: Agregar tablas de Fase 3 — Multi-usuario (A3/A4/A5/B9/F5)
        this.version(6).stores({
            participants: 'id, name, role, birthday, createdAt',
            materiaGris: 'id, participantId, createdAt',
        });

        // v7: Agregar tablas de Fase 4 — Hábitos y metas (Módulo G)
        this.version(7).stores({
            goals: 'id, participantId, status, category, createdAt',
            goalCheckIns: 'id, goalId, participantId, date, createdAt',
        });

        // v8: Agregar tabla de Fase 5 — Bienestar/Ánimo (Módulo H)
        this.version(8).stores({
            moodCheckIns: 'id, participantId, date, createdAt',
        });

        // v9: Agregar tablas de Fase 6 — Contactos y Diario personal (Módulos I y J)
        this.version(9).stores({
            contacts: 'id, name, birthday, createdAt',
            diaryEntries: 'id, date, createdAt',
        });

        // v10: Agregar tablas de catálogo dinámico (Fase 1 — 1A ambientes, 1B paletas)
        this.version(10).stores({
            ambientes: 'id, nombre, createdAt',
            paletas: 'id, name, createdAt',
        });

        // v11: Agregar tabla de horario de clases (Pizarrón)
        this.version(11).stores({
            horario: 'id, dia, materia, createdAt',
        });

        // v12: Agregar tabla del motor temporal genérico (alarmas + temporizadores)
        this.version(12).stores({
            temporalItems: 'id, kind, status, nextAt, createdAt',
        });

        // v13: Agregar tabla de perfiles de comunicación por persona (FASE P)
        this.version(13).stores({
            communicationProfiles: 'id, participantId, createdAt',
        });

        // v14: Agregar tabla de estados de onboarding por usuario (multiusuario)
        this.version(14).stores({
            onboardingStates: 'id, updatedAt',
        });

        // v15: Agregar tabla de perfiles del navegador curado (Punto 2)
        this.version(15).stores({
            browserProfiles: 'id, participantId, createdAt',
        });

        // v16: Agregar tabla de sitios del catálogo de búsqueda (F2)
        this.version(16).stores({
            searchSites: 'id, dominio, createdAt',
        });

        // v17: Agregar tabla de notas del pizarrón consolidado (listado de notas)
        this.version(17).stores({
            notes: 'id, done, personId, createdAt',
        });

        // v18: Aislar la conversación por usuario (participantId indexado).
        this.version(18).stores({
            conversations: 'id, role, timestamp, speakerId, participantId',
        });

        // v19: Aislar horario y temporales por usuario (personId indexado).
        this.version(19).stores({
            horario: 'id, dia, materia, createdAt, personId',
            temporalItems: 'id, kind, status, nextAt, createdAt, personId',
        });

        // v20: Historial de documentos/imágenes generados o cargados por usuario.
        this.version(20).stores({
            documents: 'id, kind, formato, createdAt, personId',
        });

        // v21: Calendario UNIFICADO — alarma/recordatorio/cita/junta/clase en una
        // sola tabla. El color se deriva en LECTURA (FLU_CONFIG.agenda.colors),
        // no se guarda.
        this.version(21).stores({
            agenda: 'id, kind, status, personId',
        });

        this.auditLog = this.table('auditLog');
        this.conversations = this.table('conversations');
        this.minutes = this.table('minutes');
        this.voiceProfiles = this.table('voiceProfiles');
        this.sessionState = this.table('sessionState');
        this.brandingConfig = this.table('brandingConfig');
        this.reminders = this.table('reminders');
        this.shoppingItems = this.table('shoppingItems');
        this.participants = this.table('participants');
        this.materiaGris = this.table('materiaGris');
        this.goals = this.table('goals');
        this.goalCheckIns = this.table('goalCheckIns');
        this.moodCheckIns = this.table('moodCheckIns');
        this.contacts = this.table('contacts');
        this.diaryEntries = this.table('diaryEntries');
        this.ambientes = this.table('ambientes');
        this.paletas = this.table('paletas');
        this.horario = this.table('horario');
        this.temporalItems = this.table('temporalItems');
        this.communicationProfiles = this.table('communicationProfiles');
        this.onboardingStates = this.table('onboardingStates');
        this.browserProfiles = this.table('browserProfiles');
        this.searchSites = this.table('searchSites');
        this.notes = this.table('notes');
        this.documents = this.table('documents');
        this.agenda = this.table('agenda');
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
