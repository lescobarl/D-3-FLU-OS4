// ============================================================
// musicActions - Fuente unica de los ids de accion de musica
// ------------------------------------------------------------
// El TIPO vivia en `types/bridge.ts` y el VALOR estaba copiado en gemini.ts
// (dos veces) y en voice/lib/gemini.js. Un id nuevo o renombrado obligaba a
// tocar los tres y el olvido falla en SILENCIO: el validador filtra la accion
// y no suena nada. Aqui vive el valor; los consumidores solo lo leen.
// ============================================================

/** Ids admitidos en `contract.musica.accion`. */
export const MUSIC_ACTIONS = ['play_music', 'pause_music', 'stop_music'] as const;

/** Accion de musica del contrato. */
export type MusicAction = (typeof MUSIC_ACTIONS)[number];

/** Normaliza un valor crudo a una accion valida, o `undefined` si no lo es. */
export function asMusicAction(raw: unknown): MusicAction | undefined {
    const v = String(raw ?? '').trim();
    return (MUSIC_ACTIONS as readonly string[]).includes(v) ? (v as MusicAction) : undefined;
}
