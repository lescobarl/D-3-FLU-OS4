// ============================================================
// horarioVoiceEntry — alta de horario por VOZ (scope único)
// ------------------------------------------------------------
// El dueño de una entrada creada por voz es el PARTICIPANTE ACTIVO (el mismo
// scope que lee `useHorario`), NUNCA el nombre del hablante (que no es un id y
// hacía que el panel descartara la entrada). Este módulo es la ÚNICA ruta de
// alta por voz: normaliza el intent, deriva el fin por defecto y delega en el
// servicio, de modo que el scope sea verificable ejecutando el flujo real.
// Regla #1: la duración por defecto se inyecta (config), no se hardcodea.
// ============================================================

import { toHHMM, toMin } from '../agenda/agendaShared';
import type { AddHorarioResult, HorarioService } from './horarioService';
import type { HorarioIntentData } from './horarioIntentParser';

/** Scope y parámetros de la alta por voz. */
export interface HorarioVoiceScope {
    /** Usuario dueño de la entrada (el MISMO que usa `useHorario`). */
    personId?: string;
    /** Duración por defecto (min) cuando no se dicta hora de fin. */
    defaultDurationMinutes?: number;
}

/** Entrada de horario normalizada y lista para el servicio. */
export interface HorarioVoiceEntry {
    materia: string;
    dia: number;
    inicio: string;
    fin: string;
    aula?: string;
    personId?: string;
}

const FALLBACK_DURATION_MINUTES = 60;

/**
 * Normaliza los datos de un intent `horario.add` a una entrada lista para el
 * servicio. Devuelve `null` si faltan materia/día/inicio (no se persiste nada).
 */
export function buildHorarioVoiceEntry(
    data: HorarioIntentData,
    scope: HorarioVoiceScope,
): HorarioVoiceEntry | null {
    const materia = String(data?.materia || '').trim();
    const dia = data?.dia;
    const inicio = String(data?.inicio || '').trim();
    if (!materia || !Number.isInteger(dia) || !inicio) return null;

    let fin = String(data?.fin || '').trim();
    if (!fin) {
        const raw = Number(scope.defaultDurationMinutes);
        const duration = Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_DURATION_MINUTES;
        const startMin = toMin(inicio);
        fin = toHHMM(startMin >= 0 ? startMin + duration : duration);
    }

    return { materia, dia: dia as number, inicio, fin, aula: data?.aula, personId: scope.personId };
}

/**
 * Alta de horario por voz: construye la entrada con el scope del participante
 * activo y la persiste por el servicio. Devuelve el resultado del servicio y
 * la entrada normalizada (para componer la respuesta).
 */
export async function addHorarioVoiceEntry(
    service: Pick<HorarioService, 'add'>,
    data: HorarioIntentData,
    scope: HorarioVoiceScope,
): Promise<{ result: AddHorarioResult; entry: HorarioVoiceEntry | null }> {
    const entry = buildHorarioVoiceEntry(data, scope);
    if (!entry) return { result: { ok: false, reason: 'invalid-input' }, entry: null };
    const result = await service.add({
        materia: entry.materia,
        dia: entry.dia,
        inicio: entry.inicio,
        fin: entry.fin,
        aula: entry.aula,
        personId: entry.personId,
    });
    return { result, entry };
}
