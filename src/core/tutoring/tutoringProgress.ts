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
import { mentionsTutoringArea, resolveTutoringArea, type TutoringArea } from './tutoringModel';

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
    /** Area de tutoria etiquetada EXPLICITAMENTE en la minuta (P8.58). */
    tutoring_area?: string;
    /** Practica de la sesion (P8.63): aciertos/errores que conto el tutor. */
    practica?: { aciertos: number; errores: number };
    summarySnapshot?: Omit<TutoringMinuteLike, 'summarySnapshot'>;
}

/** Avance agregado de un area. */
export interface TutoringProgress {
    area: TutoringArea;
    /** Numero de minutas de esa area. */
    sesiones: number;
    /** Lo trabajado en cada sesion (resumen), sin repetir. */
    practicado: string[];
    /** Lo que quedo pendiente o para la siguiente sesion, sin repetir (union). */
    pendientes: string[];
    /** Fecha/etiqueta de la sesion mas reciente (tal como la trae la minuta). */
    ultimaFecha: string;
    /** Fecha/etiqueta de la sesion mas ANTIGUA (da el rango del avance). */
    primeraFecha: string;
    /** Pendientes de la sesion MAS RECIENTE (lo que esta en curso ahora). */
    enCurso: string[];
    /** Pendientes de sesiones previas que YA NO figuran en la mas reciente. */
    anteriores: string[];
    /** Dominio por destreza (P8.63): aciertos/errores y % de acierto (0 si no hay). */
    dominio: { aciertos: number; errores: number; precision: number };
}

function emptyProgress(area: TutoringArea): TutoringProgress {
    return { area, sesiones: 0, practicado: [], pendientes: [], ultimaFecha: '', primeraFecha: '', enCurso: [], anteriores: [], dominio: { aciertos: 0, errores: 0, precision: 0 } };
}

function snapshotOf(record: TutoringMinuteLike = {}): TutoringMinuteLike {
    return { ...record, ...(record.summarySnapshot || {}) };
}

/** Texto buscable de una minuta: tema de sesion + titulo + resumen. */
export function minuteSearchText(record: TutoringMinuteLike = {}): string {
    const snapshot = snapshotOf(record);
    return normalizeSpaces(
        [snapshot.tema_sesion, snapshot.tutoring_area, snapshot.titulo || snapshot.description, snapshot.resumen]
            .filter(Boolean)
            .join(' '),
    );
}

/** ¿La minuta trata del area? (mencion del area o de sus sinonimos, por palabra completa). */
export function minuteCoversTutoringArea(record: TutoringMinuteLike = {}, area: TutoringArea): boolean {
    // La etiqueta EXPLICITA manda: una clase de ingles resumida como "Past
    // simple" se cuenta igual. Solo si no hay etiqueta se cae al texto.
    const tagged = snapshotOf(record).tutoring_area;
    if (tagged) {
        const resolved = resolveTutoringArea(String(tagged));
        if (resolved && resolved.id === area.id) return true;
    }
    return mentionsTutoringArea(minuteSearchText(record), area);
}

function pushUnique(target: string[], value: string, max = 5): void {
    const clean = normalizeSpaces(value);
    if (!clean) return;
    if (target.some((item) => cleanForSpeech(item).toLowerCase() === cleanForSpeech(clean).toLowerCase())) return;
    if (target.length < max) target.push(clean);
}

/** Pendientes de UNA sesion (pendientes + siguientes pasos), sin repetir. */
function pendingOf(snapshot: TutoringMinuteLike = {}): string[] {
    const out: string[] = [];
    for (const item of snapshot.pendientes || []) pushUnique(out, item);
    for (const item of snapshot.siguientes_pasos || []) pushUnique(out, item);
    return out;
}

/** Fecha/etiqueta de una minuta (tal como la trae; la presenta la capa de voz). */
function dateOf(snapshot: TutoringMinuteLike = {}): string {
    return normalizeSpaces(String(snapshot.date || snapshot.historyCode || ''));
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
    const pendingBySession: string[][] = [];
    let dominioAciertos = 0;
    let dominioErrores = 0;
    for (const record of Array.isArray(records) ? records : []) {
        if (!record || !minuteCoversTutoringArea(record, area)) continue;
        const snapshot = snapshotOf(record);
        progress.sesiones += 1;
        pushUnique(progress.practicado, String(snapshot.resumen || snapshot.titulo || ''));
        const sessionPending = pendingOf(snapshot);
        for (const item of sessionPending) pushUnique(progress.pendientes, item);
        pendingBySession.push(sessionPending);
        const fecha = dateOf(snapshot);
        if (!progress.ultimaFecha) progress.ultimaFecha = fecha;
        // El orden es mas-reciente-primero: la ultima fecha asignada es la mas antigua.
        if (fecha) progress.primeraFecha = fecha;
        const practica = snapshot.practica;
        if (practica) {
            dominioAciertos += Math.max(0, Math.floor(Number(practica.aciertos) || 0));
            dominioErrores += Math.max(0, Math.floor(Number(practica.errores) || 0));
        }
    }
    // Avance DERIVADO, sin umbrales inventados: lo pendiente de la sesion MAS
    // RECIENTE esta EN CURSO; lo que estaba pendiente antes y ya NO figura en la
    // ultima sesion es lo ANTERIOR (dejo de estar pendiente).
    progress.enCurso = pendingBySession.length ? [...pendingBySession[0]] : [];
    const enCursoKey = new Set(progress.enCurso.map((item) => cleanForSpeech(item).toLowerCase()));
    for (const session of pendingBySession.slice(1)) {
        for (const item of session) {
            if (!enCursoKey.has(cleanForSpeech(item).toLowerCase())) pushUnique(progress.anteriores, item);
        }
    }
    const totalDominio = dominioAciertos + dominioErrores;
    progress.dominio = {
        aciertos: dominioAciertos,
        errores: dominioErrores,
        precision: totalDominio > 0 ? Math.round((dominioAciertos / totalDominio) * 100) : 0,
    };
    return progress;
}
