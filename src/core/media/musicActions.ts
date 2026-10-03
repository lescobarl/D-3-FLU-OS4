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
// Peticion de MUSICA por TEXTO (no es una jugada).
//
// La musica se reproduce por el campo 'musica' del contrato del LLM (no hay
// parser determinista de texto). Para que, con una PARTIDA ACTIVA, el motor no
// se coma una peticion de musica (regla 19 de AGENTS.md), aqui vive el UNICO
// predicado. Acotado a MARCOS EXPLICITOS de peticion/control: la letra o un
// titulo suelto NO son una peticion, asi que no pisa a los juegos musicales.
// Consumidor: isClaimedByOtherDomain (src/voice/lib/gameCommands.js).
// ------------------------------------------------------------------
const MUSIC_REQUEST_FRAMES = [
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
    'pausa la musica',
    'para la musica',
    'quita la musica',
    'deten la musica',
    'apaga la musica',
];

/** true si el texto es una PETICION o CONTROL de musica (por tanto, no una jugada). */
export function isMusicRequestText(text: unknown): boolean {
    const norm = normalizeForMatch(String(text ?? ''));
    if (!norm) return false;
    return MUSIC_REQUEST_FRAMES.some((frame) => norm.includes(frame));
}
