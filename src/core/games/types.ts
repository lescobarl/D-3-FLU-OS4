// ============================================================
// src/core/games/types.ts
// Tipos puros compartidos por todos los juegos (plan-juegos §1).
// Sin imports: módulo autónomo de tipos.
// ============================================================

export type GameId =
    | 'simon_dice' | 'adivinanzas' | 'veo_veo' | 'adivina_numero'
    | 'calculo_mental' | 'palabras_encadenadas'
    | 'quien_soy' | 'ahorcado' | 'memoria_secuencias' | 'trabalenguas'
    | 'trivia' | 'ordena_secuencia' | 'adivina_cancion' | 'cuentacuentos'
    | 'cuento_colaborativo' | 'repite_traduce' | 'cuenta_conmigo'
    | 'abecedario' | 'loteria' | 'respiracion' | 'karaoke';

export type AvatarAnimation =
    | 'Dance' | 'Run' | 'Walk' | 'Jump_in_place' | 'Idle';

export interface GameTurnResult {
    prompt: string;          // lo que FLU dice
    valid: boolean;          // si el turno del jugador fue correcto
    gameOver: boolean;
    score: number;
    nextPrompt?: string;     // si hay que seguir
    animation?: AvatarAnimation;
    emotion?: string;
    error?: string;          // mensaje amigable si el turno no se entendió
    /**
     * Resultado de la partida cuando `gameOver` es true: `true` = victoria,
     * `false` = derrota/rendición. Permite que la voz celebre solo victorias
     * (antes TODO `gameOver` se gritaba como triunfo).
     */
    won?: boolean;
}

export interface GameSession {
    id: GameId;
    state: Record<string, unknown>; // estado específico del juego (serializable)
    score: number;
    round: number;
}

export type GameActionType = 'start' | 'turn' | 'end' | 'narrate';

export interface GameNarrativeScene {
    texto: string;
    animacion?: string;
    emocion?: string;
}

export interface GameContract {
    gameId: GameId;
    action: GameActionType;
    playerText?: string;   // respuesta del jugador (turn)
    narrative?: {          // solo para cuentacuentos / cuento colaborativo
        scenes: GameNarrativeScene[];
    };
}
