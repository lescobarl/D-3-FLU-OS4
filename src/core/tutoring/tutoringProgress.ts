// ============================================================
// tutoringProgress - Avance de una TUTORIA derivado de las MINUTAS.
// ------------------------------------------------------------
// Las minutas son el UNICO almacen del avance (AGENTS 7.7.c: un dominio, un
// almacen): aqui no se guarda nada nuevo, se DERIVA. Evita la tentacion de una
// tabla `tutoringProgress` paralela que divergiria de las minutas.
//
// Este modulo es PURO y no ordena: el orden (mas reciente primero) lo fija
// quien tiene el comparador de codigos de minuta, para no reimplementarlo.
// ============================================================
import { cleanForSpeech, normalizeSpaces } from '../../lib/textUtils';
import { mentionsTutoringArea, type TutoringArea } from './tutoringModel';

/** Minuta tal como la ven los helpers (campos opcionales, snapshot anidado o plano). */
export interface TutoringMinuteLike {
    id?: string;
    kind?: string;
    description?: string;
    date?: string;
    historyCode?: string;
    titulo?: string;
    tema_sesion?: string;
    resumen?: string;
    acuerdos?: string[];
    pendientes?: string[];
    siguientes_pasos?: string[];
    summarySnapshot?: Omit<TutoringMinuteLike, 'summarySnapshot'>;
}

/** Avance agregado de un area. */
export interface TutoringProgress {
    area: TutoringArea;
    /** Numero de minutas de esa area. */
    sesiones: number;
    /** Lo trabajado en cada sesion (resumen), sin repetir. */
    practicado: string[];
    /** Lo que quedo pendiente o para la siguiente sesion, sin repetir. */
    pendientes: string[];
    /** Fecha/etiqueta de la sesion mas reciente (tal como la trae la minuta). */
    ultimaFecha: string;
}

function emptyProgress(area: TutoringArea): TutoringProgress {
    return { area, sesiones: 0, practicado: [], pendientes: [], ultimaFecha: '' };
}

function snapshotOf(record: TutoringMinuteLike = {}): TutoringMinuteLike {
    return { ...record, ...(record.summarySnapshot || {}) };
}

/** Texto buscable de una minuta: tema de sesion + titulo + resumen. */
export function minuteSearchText(record: TutoringMinuteLike = {}): string {
    const snapshot = snapshotOf(record);
    return normalizeSpaces(
        [snapshot.tema_sesion, snapshot.titulo || snapshot.description, snapshot.resumen]
            .filter(Boolean)
            .join(' '),
    );
}

/** ¿La minuta trata del area? (mencion del area o de sus sinonimos, por palabra completa). */
export function minuteCoversTutoringArea(record: TutoringMinuteLike = {}, area: TutoringArea): boolean {
    return mentionsTutoringArea(minuteSearchText(record), area);
}

function pushUnique(target: string[], value: string, max = 5): void {
    const clean = normalizeSpaces(value);
    if (!clean) return;
    if (target.some((item) => cleanForSpeech(item).toLowerCase() === cleanForSpeech(clean).toLowerCase())) return;
    if (target.length < max) target.push(clean);
}

/**
 * Avance del area agregando las minutas que la mencionan, EN EL ORDEN RECIBIDO
 * (la mas reciente primero, decision de quien tiene el comparador).
 */
export function buildTutoringProgress(
    records: TutoringMinuteLike[] = [],
    area: TutoringArea,
): TutoringProgress {
    const progress = emptyProgress(area);
    for (const record of Array.isArray(records) ? records : []) {
        if (!record || !minuteCoversTutoringArea(record, area)) continue;
        const snapshot = snapshotOf(record);
        progress.sesiones += 1;
        pushUnique(progress.practicado, String(snapshot.resumen || snapshot.titulo || ''));
        for (const item of snapshot.pendientes || []) pushUnique(progress.pendientes, item);
        for (const item of snapshot.siguientes_pasos || []) pushUnique(progress.pendientes, item);
        if (!progress.ultimaFecha) {
            progress.ultimaFecha = normalizeSpaces(String(snapshot.date || snapshot.historyCode || ''));
        }
    }
    return progress;
}
