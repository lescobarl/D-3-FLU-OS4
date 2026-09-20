// ============================================================
// src/core/agenda/agendaShared.ts
// Utilidades y TIPOS compartidos del calendario unificado.
// ------------------------------------------------------------
// Fuente única (sin doble ruta) de las utilidades de tiempo/hora y de la
// estructuración OCR de horarios que consumen los paneles, hooks y parsers.
// Los CRUD viven en `agendaService.ts` (única fuente de mutación).
// ============================================================

import { stripDiacritics } from '../../lib/textUtils';

// ------------------------------------------------------------
// Tipos de entrada (estructuración OCR de horarios)
// ------------------------------------------------------------

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

/** Detecta el día (1-7) a partir de un texto con nombre de día en español. */
export function clasificarDia(value: string): number | null {
    const norm = stripDiacritics(String(value || '')).toLowerCase().trim();
    if (!norm) return null;
    if (DIA_MAP[norm] != null) return DIA_MAP[norm];
    for (const [name, num] of Object.entries(DIA_MAP)) {
        if (norm.includes(name)) return num;
    }
    return null;
}

/** true si TODO el texto son nombres de días (p. ej. "Lunes" o "Lunes martes"). */
export function esNombreDeDia(value: string): boolean {
    const norm = stripDiacritics(String(value || '')).toLowerCase().trim();
    if (!norm) return false;
    return norm
        .split(/\s+/)
        .filter(Boolean)
        .every((word) => DIA_MAP[word] != null);
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
        let materia = cleanMateria(before);
        let aula = extractAula(after);
        // Orden inline "Lunes 08:00-09:00 Matemáticas": si lo previo al rango es solo
        // un día (o está vacío), la materia real viene DESPUÉS del rango.
        if (!materia || esNombreDeDia(before)) {
            const afterSinAula = cleanMateria(after.replace(AULA_RE, ''));
            if (afterSinAula) materia = afterSinAula;
        }
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
