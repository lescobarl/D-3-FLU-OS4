// ============================================================
// src/core/games/gameSpeech.ts
// Mapeo puro entre el resultado de un motor de juego y los
// overrides de voz (rate/pitch/volume) que se aplican al hablar.
//
// Regla de oro: el motor es la única fuente de verdad del estado de
// la partida; este módulo NO toca el motor, solo decide CÓMO se
// pronuncia el prompt que el motor ya produjo.
//
// Módulo puro: sin I/O, sin imports .js, determinista y testeable.
// ============================================================

/** Overrides opcionales de voz por llamada (rango W3C de volume: [0,1]). */
export interface GameSpeechOptions {
    volume?: number;
    rate?: number;
    pitch?: number;
}

/**
 * "Grito" de victoria: se aplica a todo cierre de partida (gameOver).
 * El volumen se mantiene dentro del rango W3C [0,1] (1.0 = máximo, en
 * especificación); la energía se transmite con rate/pitch elevados.
 */
export const WIN_SHOUT: GameSpeechOptions = Object.freeze({
    volume: 1.0,
    rate: 1.25,
    pitch: 1.2,
});

/** Celebración puntual (acierto con animación festiva, no fin de partida). */
export const CELEBRATION_BOOST: GameSpeechOptions = Object.freeze({
    volume: 1.0,
    rate: 1.1,
    pitch: 1.05,
});

/** Animaciones festivas que emiten los motores al acertar (fuente: catálogo). */
const CELEBRATION_ANIMS: ReadonlySet<string> = new Set(['Dance', 'Jump_in_place']);

/** Subconjunto de GameTurnResult que decide los overrides de voz. */
export interface GameSpeechResult {
    gameOver?: boolean;
    animation?: string;
    emotion?: string;
}

/**
 * Resuelve los overrides de voz para el prompt de un resultado de motor.
 * - gameOver → grito de victoria (fin de partida).
 * - animación de celebración no final → boost moderado.
 * - resto → sin overrides (respeta la config de voz del perfil activo).
 */
export function resolveGameSpeechOptions(result: GameSpeechResult): GameSpeechOptions {
    if (!result) return {};
    if (result.gameOver) return WIN_SHOUT;
    if (result.animation && CELEBRATION_ANIMS.has(result.animation)) {
        return CELEBRATION_BOOST;
    }
    return {};
}
