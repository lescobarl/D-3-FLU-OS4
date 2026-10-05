// ============================================================
// tutoringReview - REPASO espaciado derivado de las MINUTAS (P8.66).
// ------------------------------------------------------------
// Las minutas siguen siendo el UNICO almacen: aqui no se guarda nada nuevo, se
// DERIVA que toca repasar. Un tema esta VENCIDO cuando quedo pendiente en la
// ultima sesion de su area y esa sesion tiene al menos el primer intervalo de
// antiguedad (no se repasa lo de hoy). Los intervalos son datos DECLARADOS aqui
// (ajustarlos es tocar esta tabla), no umbrales inventados por el agente.
// Modulo PURO.
// ============================================================
import { type TutoringArea } from './tutoringModel';
import { type TutoringProgress } from './tutoringProgress';
import { isDayKey } from '../../lib/dateKey';

/** Intervalos de repaso en dias. Declarados y ajustables AQUI (P8.66). */
export const REVIEW_INTERVALS_DAYS: readonly number[] = Object.freeze([1, 3, 7, 21]);

const MS_PER_DAY = 86400000;

/** Una fila del repaso: el area, sus pendientes en curso y su antiguedad. */
export interface TutoringReviewDue {
    area: TutoringArea;
    /** Temas pendientes de la ultima sesion (lo que hay que repasar). */
    temas: string[];
    /** Dias desde la ultima sesion del area. */
    dias: number;
    /** Mayor intervalo alcanzado (0 si aun no vence). */
    intervalo: number;
}

/** Resultado del repaso. */
export interface TutoringReview {
    due: TutoringReviewDue[];
    intervalos: readonly number[];
}

/** Fuente del repaso: un area con su progreso derivado. */
export interface TutoringReviewSource {
    area: TutoringArea;
    progress: TutoringProgress;
}

/** Dias enteros entre una fecha YYYY-MM-DD y `nowMs`; `null` si no hay fecha valida. */
export function daysSince(isoDate: string = '', nowMs: number = Date.now()): number | null {
    if (!isDayKey(isoDate)) return null;
    const then = Date.parse(`${isoDate}T00:00:00Z`);
    if (!Number.isFinite(then)) return null;
    return Math.max(0, Math.floor((nowMs - then) / MS_PER_DAY));
}

/** Banda de repaso: el mayor intervalo <= `dias` (0 si aun no alcanza el primero). */
export function reviewBand(dias: number, intervalos: readonly number[] = REVIEW_INTERVALS_DAYS): number {
    let band = 0;
    for (const interval of intervalos) {
        if (dias >= interval) band = interval;
    }
    return band;
}

/**
 * Repasos VENCIDOS: por cada area con pendientes en curso, si su ultima sesion
 * tiene al menos el primer intervalo de antiguedad, se anade con sus dias y su banda.
 */
export function buildTutoringReview(sources: TutoringReviewSource[] = [], nowMs: number = Date.now()): TutoringReview {
    const due: TutoringReviewDue[] = [];
    for (const { area, progress } of Array.isArray(sources) ? sources : []) {
        if (!progress || !progress.enCurso || !progress.enCurso.length) continue;
        const dias = daysSince(progress.ultimaFechaISO, nowMs);
        if (dias === null || dias < REVIEW_INTERVALS_DAYS[0]) continue;
        due.push({ area, temas: [...progress.enCurso], dias, intervalo: reviewBand(dias) });
    }
    return { due, intervalos: REVIEW_INTERVALS_DAYS };
}
