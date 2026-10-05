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
//
// DOS MODOS DE ACIERTO, una sola tabla (P8.54):
//   - marcos por SUBCADENA (MUSIC_PLAY_FRAMES / MUSIC_CONTROL_FRAMES): llevan el
//     objeto de la accion ("para la musica") y no pueden confundirse con otra cosa.
//   - palabras SUELTAS de parada (MUSIC_STOP_WORDS): son ambiguas ("alto" tambien
//     es "alto de estatura"), asi que exigen que el mandato ENTERO sea la palabra.
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

/**
 * Palabras SUELTAS de parada (P8.54): solo cuentan cuando el mandato ENTERO es
 * la palabra, NUNCA por subcadena. "alto" es ambigua ("habla mas alto", "el
 * arbol es alto"), asi que `includes` detendria la musica con una frase que no
 * la pide. `alto` y `stop` ya son salidas cortas del vocabulario de partida
 * (gameUtils.END_GAME_FRAMES, por token): con una partida activa el paso 1 del
 * enrutador de juego las resuelve como `end` ANTES que este modulo, asi que el
 * juego se sigue cerrando con la misma palabra y ademas se detiene la musica.
 */
const MUSIC_STOP_WORDS: readonly string[] = Object.freeze(['alto', 'stop']);

/** El mandato ENTERO es una palabra de parada ("Alto!" -> si; "habla mas alto" -> no). */
function isBareStopWord(norm: string): boolean {
    const trimmed = norm.replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '');
    return MUSIC_STOP_WORDS.includes(trimmed);
}

/** Todos los marcos de musica (una sola fuente para las dos preguntas). */
const MUSIC_REQUEST_FRAMES: readonly string[] = Object.freeze([
    ...MUSIC_PLAY_FRAMES,
    ...MUSIC_CONTROL_FRAMES.flatMap((c) => c.frames),
]);

/** true si el texto es una PETICION o CONTROL de musica (por tanto, no una jugada). */
export function isMusicRequestText(text: unknown): boolean {
    const norm = normalizeForMatch(String(text ?? ''));
    if (!norm) return false;
    // Palabra suelta de parada ("alto", "stop"): si, es peticion de musica.
    if (isBareStopWord(norm)) return true;
    return MUSIC_REQUEST_FRAMES.some((frame) => norm.includes(frame));
}

/**
 * Accion de CONTROL de musica pedida por el texto (`stop_music` | `pause_music`),
 * o `null` si no pide control. DUENO UNICO de la decision (la tabla de arriba).
 */
export function resolveMusicControl(text: unknown): MusicAction | null {
    const norm = normalizeForMatch(String(text ?? ''));
    if (!norm) return null;
    // Palabra suelta de parada (P8.54): "alto" / "stop" a secas. Va ANTES de los
    // marcos por subcadena porque su unico modo de acierto es el mandato entero.
    if (isBareStopWord(norm)) return 'stop_music';
    for (const control of MUSIC_CONTROL_FRAMES) {
        if (control.frames.some((frame) => norm.includes(frame))) return control.accion;
    }
    return null;
}
