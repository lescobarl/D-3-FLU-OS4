// ============================================================
// Horario Service — Horario GENÉRICO en el Pizarrón
// ------------------------------------------------------------
// Persistencia de entradas de un horario semanal GENÉRICO sobre
// Dexie. No está atado a "clases escolares" ni a un carnet fijo:
// cada registro lleva un campo `tipo` libre (escuela, medico,
// trabajo, gimnasio…) para representar cualquier agenda recurrente.
//   - Obligación #6: UUIDv4 (id)
//   - Obligación #7: tupla Sync [revision, updated_at, deleted]
//   - Obligación #5: log de auditoría en cada mutación
//   - Regla #1: sin hardcode; límites desde FLU_CONFIG.horario
// Inyección de dependencias: { db, config, now, newId }.
// Incluye la capa de estructuración OCR (structureHorarioText)
// que convierte el texto_extraido de analyzeImage en entradas.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { addAuditLog, type HorarioRecord, type SyncTuple } from '../db/fluDatabase';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

// El tipo de registro proviene de la capa de base de datos
// (fuente única de verdad — Regla de oro) y se re-exporta aquí.
export type { HorarioRecord } from '../db/fluDatabase';

export interface NewHorarioInput {
  /** Título legible de la entrada (materia, consulta, actividad…). */
  materia: string;
  /** Etiqueta libre del tipo de horario (escuela, medico, trabajo…). Opcional. */
  tipo?: string;
  /** 1=Lunes ... 7=Domingo (ISO 8601). */
  dia: number;
  /** Hora local 'HH:MM' de 24 h. */
  inicio: string;
  /** Hora local 'HH:MM' de 24 h. */
  fin: string;
  /** Lugar opcional (aula, consultorio, oficina…). */
  aula?: string;
  color?: string;
}

export interface HorarioConfig {
  /** Máximo de clases por día. */
  maxClasesPorDia: number;
  /** Día mínimo del rango (1=Lunes). */
  diaMin: number;
  /** Día máximo del rango (7=Domingo). */
  diaMax: number;
  /** Color por defecto (token de FLU_CONFIG.horario.colores). */
  defaultColor: string;
  /** Catálogo de colores permitidos (sin hardcode). */
  colores: readonly string[];
}

export interface HorarioDb {
  add(record: HorarioRecord): Promise<unknown>;
  put(record: HorarioRecord): Promise<unknown>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<HorarioRecord | undefined>;
  toArray(): Promise<HorarioRecord[]>;
}

export interface HorarioServiceOptions {
  db: HorarioDb;
  config: HorarioConfig;
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Generador de id (por defecto: uuid v4). */
  newId?: () => string;
}

export interface AddHorarioResult {
  ok: boolean;
  record?: HorarioRecord;
  reason?: 'invalid-input' | 'max-per-dia';
}

/** Entrada estructurada a partir del texto OCR de un horario. */
export interface HorarioClaseEstructurada {
  /** Título legible de la entrada (materia, consulta, actividad…). */
  materia: string;
  /** Etiqueta libre del tipo de horario detectado (opcional). */
  tipo?: string;
  dia: number;
  inicio: string;
  fin: string;
  aula?: string;
}

// ------------------------------------------------------------
// Helpers de tiempo (exportados para tests y render)
// ------------------------------------------------------------

/**
 * Convierte 'HH:MM' de 24 h a minutos desde medianoche.
 * Devuelve -1 si el valor no es una hora válida.
 */
export function toMin(time: string): number {
  if (typeof time !== 'string') return -1;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return -1;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return -1;
  return h * 60 + min;
}

/** Convierte minutos desde medianoche a 'HH:MM' (recortado a 0..1439). */
export function toHHMM(minutes: number): string {
  if (!Number.isFinite(minutes)) return '';
  const clamped = Math.max(0, Math.min(1439, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Día ISO local (1=Lunes ... 7=Domingo) para un timestamp. */
export function diaDeFecha(at: number): number {
  const d = new Date(at);
  return ((d.getDay() + 6) % 7) + 1;
}

/** Minutos desde medianoche (hora local) para un timestamp. */
export function minutosDeFecha(at: number): number {
  const d = new Date(at);
  return d.getHours() * 60 + d.getMinutes();
}

// ------------------------------------------------------------
// Capa de estructuración OCR — analyzeImage.texto_extraido
// ------------------------------------------------------------

const DIA_MAP: Record<string, number> = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  domingo: 7,
};

const stripDiacriticsHorario = (value: string): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Detecta el día (1-7) a partir de un texto con nombre de día en español. */
export function clasificarDia(value: string): number | null {
  const norm = stripDiacriticsHorario(value).trim();
  if (!norm) return null;
  if (DIA_MAP[norm] != null) return DIA_MAP[norm];
  for (const [name, num] of Object.entries(DIA_MAP)) {
    if (norm.includes(name)) return num;
  }
  return null;
}

const HORA_RANGE_RE = /(?:^|[^\d])(\d{1,2})[:.](\d{2})\s*(?:-|–|—|a|to)\s*(\d{1,2})[:.](\d{2})/i;

/**
 * Extrae un rango de horas ('inicio' / 'fin' en 'HH:MM') de un texto.
 * Devuelve null si no encuentra un rango válido.
 */
export function extractHorarioHoras(value: string): { inicio: string; fin: string } | null {
  const m = HORA_RANGE_RE.exec(String(value || ''));
  if (!m) return null;
  const h1 = Number(m[1]);
  const mi1 = Number(m[2]);
  const h2 = Number(m[3]);
  const mi2 = Number(m[4]);
  if (h1 > 23 || mi1 > 59 || h2 > 23 || mi2 > 59) return null;
  const inicio = toHHMM(h1 * 60 + mi1);
  const fin = toHHMM(h2 * 60 + mi2);
  if (!inicio || !fin) return null;
  return { inicio, fin };
}

const cleanMateria = (value: string): string =>
  String(value || '')
    .replace(/^[\s\-–—•*·|]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

/** Normaliza el aula opcional: undefined si está vacía o solo contiene espacios. */
const cleanAula = (value: unknown): string | undefined => {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : undefined;
};

const AULA_RE = /\b(?:aula|sal[oó]n|salon|lab|laboratorio|taller)\s+([\wÁÉÍÓÚáéíóúÑñ.-]+)/i;

/** Extrae el aula/salón de la cola del texto (opcional). */
export function extractAula(value: string): string {
  const m = AULA_RE.exec(String(value || ''));
  return m ? m[1] : '';
}

/**
 * Estructura el texto OCR de un horario en clases {materia, dia, inicio, fin, aula}.
 * Espera líneas como:
 *   Lunes
 *   Matemáticas 08:00 - 09:30 Aula 3
 * El día se propaga a las líneas siguientes hasta el próximo encabezado de día.
 */
export function structureHorarioText(text = ''): HorarioClaseEstructurada[] {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const result: HorarioClaseEstructurada[] = [];
  let currentDia: number | null = null;

  for (const line of lines) {
    const horas = extractHorarioHoras(line);
    const diaDetected = clasificarDia(line);

    if (!horas) {
      if (diaDetected !== null) currentDia = diaDetected;
      continue;
    }

    if (diaDetected !== null) currentDia = diaDetected;
    if (currentDia === null) continue;

    const match = HORA_RANGE_RE.exec(line);
    if (!match) continue;
    const before = line.slice(0, match.index).trim();
    const after = line.slice(match.index + match[0].length).trim();
    const materia = cleanMateria(before);
    const aula = extractAula(after);
    if (!materia) continue;

    const clase: HorarioClaseEstructurada = {
      materia,
      dia: currentDia,
      inicio: horas.inicio,
      fin: horas.fin,
    };
    if (aula) clase.aula = aula;
    result.push(clase);
  }

  return result;
}

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export function createHorarioService({
  db,
  config,
  now = () => Date.now(),
  newId = uuidv4,
}: HorarioServiceOptions) {
  const timestamp = (): number => now();

  const toRecord = (row: HorarioRecord): HorarioRecord => ({ ...row });

  const buildSync = (previous?: SyncTuple): SyncTuple => {
    if (!previous) return { revision: 1, updated_at: new Date(timestamp()).toISOString(), deleted: false };
    return {
      revision: previous.revision + 1,
      updated_at: new Date(timestamp()).toISOString(),
      deleted: previous.deleted,
    };
  };

  const clampDia = (dia: number): number => {
    const n = Number(dia);
    if (!Number.isInteger(n)) return config.diaMin;
    return Math.min(config.diaMax, Math.max(config.diaMin, n));
  };

  const isValidTime = (value: string): boolean => toMin(value) >= 0;

  const add = async (input: NewHorarioInput): Promise<AddHorarioResult> => {
    const materia = typeof input?.materia === 'string' ? input.materia.trim() : '';
    const tipo = typeof input?.tipo === 'string' ? input.tipo.trim() : '';
    const dia = input?.dia;
    const inicio = typeof input?.inicio === 'string' ? input.inicio.trim() : '';
    const fin = typeof input?.fin === 'string' ? input.fin.trim() : '';

    if (!materia) return { ok: false, reason: 'invalid-input' };
    if (!Number.isInteger(dia) || dia < config.diaMin || dia > config.diaMax) {
      return { ok: false, reason: 'invalid-input' };
    }
    if (!isValidTime(inicio) || !isValidTime(fin)) return { ok: false, reason: 'invalid-input' };
    if (toMin(fin) <= toMin(inicio)) return { ok: false, reason: 'invalid-input' };

    const count = (await db.toArray()).filter((r) => clampDia(r.dia) === dia).length;
    if (count >= config.maxClasesPorDia) return { ok: false, reason: 'max-per-dia' };

    const id = newId();
    const t = timestamp();
    const record: HorarioRecord = {
      id,
      materia,
      dia,
      inicio,
      fin,
      aula: cleanAula(input.aula),
      color: config.colores.includes(String(input.color || '')) ? String(input.color).trim() : config.defaultColor,
      reminders: [],
      createdAt: t,
      updatedAt: t,
      sync: buildSync(),
    };
    if (tipo) record.tipo = tipo;
    await db.add(record);
    const auditPayload: Record<string, unknown> = { materia, dia, inicio, fin };
    if (tipo) auditPayload.tipo = tipo;
    await addAuditLog('horario.create', 'horario', id, null, auditPayload, 'horarioService');
    return { ok: true, record };
  };

  const get = async (id: string): Promise<HorarioRecord | undefined> => {
    if (!id) return undefined;
    const row = await db.get(id);
    return row ? toRecord(row) : undefined;
  };

  const list = async (): Promise<HorarioRecord[]> => {
    const all = await db.toArray();
    return all.map(toRecord);
  };

  const listByDia = async (dia: number): Promise<HorarioRecord[]> => {
    const all = await db.toArray();
    return all
      .filter((r) => clampDia(r.dia) === dia)
      .map(toRecord)
      .sort((a, b) => toMin(a.inicio) - toMin(b.inicio));
  };

  const listByMateria = async (materia: string): Promise<HorarioRecord[]> => {
    const needle = String(materia || '').trim().toLowerCase();
    if (!needle) return [];
    const all = await db.toArray();
    return all.filter((r) => r.materia.trim().toLowerCase().includes(needle)).map(toRecord);
  };

  const update = async (
    id: string,
    patch: Partial<NewHorarioInput>,
  ): Promise<HorarioRecord | null> => {
    const row = await db.get(id);
    if (!row) return null;

    const materia = patch.materia !== undefined ? String(patch.materia).trim() : row.materia;
    const dia = patch.dia !== undefined ? patch.dia : row.dia;
    const inicio = patch.inicio !== undefined ? String(patch.inicio).trim() : row.inicio;
    const fin = patch.fin !== undefined ? String(patch.fin).trim() : row.fin;

    if (!materia) return null;
    if (!Number.isInteger(dia) || dia < config.diaMin || dia > config.diaMax) return null;
    if (!isValidTime(inicio) || !isValidTime(fin)) return null;
    if (toMin(fin) <= toMin(inicio)) return null;

    const next: HorarioRecord = {
      ...row,
      materia,
      dia,
      inicio,
      fin,
      aula: patch.aula !== undefined ? cleanAula(patch.aula) : row.aula,
      color: patch.color !== undefined
        ? config.colores.includes(String(patch.color || '')) ? String(patch.color).trim() : row.color
        : row.color,
      updatedAt: timestamp(),
      sync: buildSync(row.sync),
    };
    if (patch.tipo !== undefined) {
      const tipo = String(patch.tipo).trim();
      if (tipo) next.tipo = tipo;
      else delete next.tipo;
    }
    await db.put(next);
    await addAuditLog('horario.update', 'horario', id, row, next, 'horarioService');
    return toRecord(next);
  };

  const remove = async (id: string): Promise<boolean> => {
    const row = await db.get(id);
    if (!row) return false;
    await db.delete(id);
    await addAuditLog('horario.remove', 'horario', id, row, null, 'horarioService');
    return true;
  };

  const countPorDia = async (dia: number): Promise<number> => {
    const all = await db.toArray();
    return all.filter((r) => clampDia(r.dia) === dia).length;
  };

  /** Próxima clase a partir de un instante (da la vuelta a la semana si no queda ninguna). */
  const proximaClase = async (at?: number): Promise<HorarioRecord | null> => {
    const reference = at ?? timestamp();
    const all = await db.toArray();
    const nowKey = diaDeFecha(reference) * 1440 + minutosDeFecha(reference);

    let best: HorarioRecord | null = null;
    let bestKey = Infinity;
    for (const r of all) {
      const start = toMin(r.inicio);
      if (start < 0) continue;
      const key = clampDia(r.dia) * 1440 + start;
      if (key > nowKey && key < bestKey) {
        bestKey = key;
        best = r;
      }
    }
    if (best) return toRecord(best);

    // Vuelta a la semana: la clase más temprana del ciclo.
    let wrapKey = Infinity;
    for (const r of all) {
      const start = toMin(r.inicio);
      if (start < 0) continue;
      const key = clampDia(r.dia) * 1440 + start;
      if (key < wrapKey) {
        wrapKey = key;
        best = r;
      }
    }
    return best ? toRecord(best) : null;
  };

  /** Clases del día (1-7) ordenadas por hora de inicio. */
  const clasesDeHoy = async (at?: number): Promise<HorarioRecord[]> => {
    const reference = at ?? timestamp();
    const dia = diaDeFecha(reference);
    const all = await db.toArray();
    return all
      .filter((r) => clampDia(r.dia) === dia)
      .map(toRecord)
      .sort((a, b) => toMin(a.inicio) - toMin(b.inicio));
  };

  return {
    add,
    get,
    list,
    listByDia,
    listByMateria,
    update,
    remove,
    countPorDia,
    proximaClase,
    clasesDeHoy,
    structureHorarioText,
  };
}

export type HorarioService = ReturnType<typeof createHorarioService>;
