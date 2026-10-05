// ============================================================
// musicActions - Fuente unica de los ids de accion de musica
// ------------------------------------------------------------
// El TIPO vivia en `types/bridge.ts` y el VALOR estaba copiado en gemini.ts
// (dos veces) y en voice/lib/gemini.js. Un id nuevo o renombrado obligaba a
// tocar los tres y el olvido falla en SILENCIO: el validador filtra la accion
// y no suena nada. Aqui vive el valor; los consumidores solo lo leen.
// ============================================================

/** Ids admitidos en `contract.musica.accion`. */
import { normalizeForMatch } from '../../lib/textUtils';

export const MUSIC_ACTIONS = ['play_music', 'pause_music', 'stop_music'] as const;

/** Accion de musica del contrato. */
export type MusicAction = (typeof MUSIC_ACTIONS)[number];

/** Normaliza un valor crudo a una accion valida, o `undefined` si no lo es. */
export function asMusicAction(raw: unknown): MusicAction | undefined {
    const v = String(raw ?? '').trim();
    return (MUSIC_ACTIONS as readonly string[]).includes(v) ? (v as MusicAction) : undefined;
}
// ------------------------------------------------------------------
// Peticion y CONTROL de MUSICA por TEXTO.
//
// La musica se reproduce por el campo 'musica' del contrato. Aqui vive la UNICA
// tabla de marcos de texto y las DOS preguntas que se derivan de ella:
//   - isMusicRequestText: "¿es una peticion o control de musica?" (para que un
//     juego activo no se coma el turno: regla 19 de AGENTS.md).
//   - resolveMusicControl: "¿pide DETENER o PAUSAR la musica?" (accion concreta).
// Antes los marcos de control existian SOLO como guardia de reclamo: la accion
// no la ejecutaba nadie y quedaba a merced del LLM, que respondia "Alto." a
// "okay flow alto" y no detenia nada.
// ------------------------------------------------------------------
const MUSIC_PLAY_FRAMES: readonly string[] = Object.freeze([
    'pon musica',
    'ponme musica',
    'pon algo de musica',
    'reproduce musica',
    'quiero escuchar musica',
    'pon una cancion',
    'ponme una cancion',
    'pon la cancion',
    'pon esta cancion',
    'reproduce una cancion',
    'reproduce la cancion',
]);

/** Marcos de CONTROL → accion de musica. Orden: el primero que casa gana. */
const MUSIC_CONTROL_FRAMES: ReadonlyArray<{ accion: MusicAction; frames: readonly string[] }> = Object.freeze([
    {
        accion: 'stop_music',
        frames: ['deten la musica', 'detente la musica', 'para la musica', 'apaga la musica', 'quita la musica', 'corta la musica'],
    },
    { accion: 'pause_music', frames: ['pausa la musica', 'pausa musica'] },
]);

/** Todos los marcos de musica (una sola fuente para las dos preguntas). */
const MUSIC_REQUEST_FRAMES: readonly string[] = Object.freeze([
    ...MUSIC_PLAY_FRAMES,
    ...MUSIC_CONTROL_FRAMES.flatMap((c) => c.frames),
]);

/** true si el texto es una PETICION o CONTROL de musica (por tanto, no una jugada). */
export function isMusicRequestText(text: unknown): boolean {
    const norm = normalizeForMatch(String(text ?? ''));
    if (!norm) return false;
    return MUSIC_REQUEST_FRAMES.some((frame) => norm.includes(frame));
}

/**
 * Accion de CONTROL de musica pedida por el texto (`stop_music` | `pause_music`),
 * o `null` si no pide control. DUENO UNICO de la decision (la tabla de arriba).
 */
export function resolveMusicControl(text: unknown): MusicAction | null {
    const norm = normalizeForMatch(String(text ?? ''));
    if (!norm) return null;
    for (const control of MUSIC_CONTROL_FRAMES) {
        if (control.frames.some((frame) => norm.includes(frame))) return control.accion;
    }
    return null;
}
