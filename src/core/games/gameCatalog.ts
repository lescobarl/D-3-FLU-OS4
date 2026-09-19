// ============================================================
// src/core/games/gameCatalog.ts
// Catálogo data-driven de intenciones de juego (plan-juegos §3).
// Estilo de voiceConfigCatalog.ts y de los NOUN_PAIRS de
// configCommands.js. Módulo autónomo (helpers locales de
// normalización; sin imports .js para evitar riesgo de resolución).
//
// GUARDIA TRIPLE: para iniciar un juego se requiere UN marco de
// intención de juego (PLAY_INTENT_FRAMES) Y UN alias del juego.
// "simón dice que te calles" NO dispara (falta el marco).
// "ok flu, vamos a jugar a las adivinanzas" → adivinanzas.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameId } from './types';
import { createSimonDiceEngine } from './simonDice';
import { createRiddlesEngine } from './riddles';
import { createVeoVeoEngine } from './veoVeo';
import { createAdivinaNumeroEngine } from './adivinaNumero';
import { createCalculoMentalEngine } from './calculoMental';
import { createPalabrasEncadenadasEngine } from './palabrasEncadenadas';
import { createQuienSoyEngine } from './quienSoy';
import { createAhorcadoEngine } from './ahorcado';
import { createMemoriaSecuenciasEngine } from './memoriaSecuencias';
import { createTrabalenguasEngine } from './trabalenguas';
import { createTriviaEngine } from './trivia';
import { createOrdenaSecuenciaEngine } from './ordenaSecuencia';
import { createAdivinaCancionEngine } from './adivinaCancion';
import { createCuentacuentosEngine } from './storyteller';
import { createCuentoColaborativoEngine } from './cuentoColaborativo';
import { createRepiteTraduceEngine } from './repiteTraduce';
import { createCuentaConmigoEngine } from './cuentaConmigo';
import { createAbecedarioEngine } from './abecedario';
import { createLoteriaEngine } from './loteria';
import { createRespiracionEngine } from './respiracion';
import { createKaraokeEngine } from './karaoke';

export interface GameIntentEntry {
    id: GameId;
    aliases: string[];              // 'juguemos a simón dice', 'simón dice', 'a jugar simón'
    engine: () => GameEngine;
    requiresApi?: boolean;          // true = cuentacuentos/trivia dinámica
    /** true = el motor reproduce audio (música): `playSong`/`stopMusic` aplican. */
    audio?: boolean;
    /**
     * true = mientras suena el audio la voz ambiente NO debe intervenir (karaoke:
     * el niño canta; adivina canción NO lo activa porque el niño debe responder).
     */
    suppressAmbient?: boolean;
}

/** Todos los ids válidos (normalizeJuego los valida contra esta lista). */
export const GAME_IDS: readonly GameId[] = Object.freeze([
    'simon_dice', 'adivinanzas', 'veo_veo', 'adivina_numero',
    'calculo_mental', 'palabras_encadenadas',
    'quien_soy', 'ahorcado', 'memoria_secuencias', 'trabalenguas',
    'trivia', 'ordena_secuencia', 'adivina_cancion', 'cuentacuentos',
    'cuento_colaborativo', 'repite_traduce', 'cuenta_conmigo',
    'abecedario', 'loteria', 'respiracion', 'karaoke',
  ]);

// --- Helpers locales de normalización (sin dependencias) ---

function stripDiacritics(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeForMatch(text = ''): string {
    return stripDiacritics(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function findTokenIndex(normalized = '', phrase = ''): number | null {
    if (!phrase) return null;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|\\s)${escaped}($|\\s|[.,;!?¡¿])`);
    const match = normalized.match(pattern);
    return match ? match.index ?? null : null;
}

function hasToken(normalized = '', phrase = ''): boolean {
    return findTokenIndex(normalized, phrase) !== null;
}

// --- Guardias (data-driven) ---

/** Marcos de intención de juego. Ninguno aislado dispara start. */
const PLAY_INTENT_FRAMES: readonly string[] = Object.freeze([
    'vamos a jugar',
    'vamos a jugar a',
    'juguemos',
    'juguemos a',
    'a jugar',
    'quiero jugar',
    'quiero jugar a',
    'juega conmigo',
    'juego de',
    'un juego de',
    'jugar a',
    'empecemos a jugar',
    'quien quiere jugar',
]);

/** Frases negativas que NUNCA deben iniciar un juego (guardia anti-falso-positivo). */
const NEGATIVE_INTENT_FRAMES: readonly string[] = Object.freeze([
    'no quiero jugar',
    'ya no quiero jugar',
    'no juguemos',
    'ya no juguemos',
    'deja de jugar',
    'parar de jugar',
    'dejemos de jugar',
]);

/**
 * Frases de salida de una partida activa (fuente única de verdad).
 * Las consume el fast-path de voz (gameCommands.js) para emitir `end`
 * SOLO cuando hay partida activa; en solitario nunca inician un juego.
 */
export const END_GAME_FRAMES: readonly string[] = Object.freeze([
    'salir del juego',
    'terminar el juego',
    'dejar de jugar',
    'ya no quiero jugar',
    'cerrar el juego',
    'terminemos',
    'ya basta',
    'se acabo',
    // Salidas cortas (antes había que decir la frase completa y quedaba atrapado).
    'salir',
    'terminar',
    'termina',
    'basta',
    'parar',
    'stop',
    'no quiero jugar',
    'fin del juego',
    'cancelar el juego',
    'cancela el juego',
]);

/**
 * Con una partida ACTIVA, frases que piden el MENÚ de juegos (no son un turno
 * del juego). Sin esto, "¿qué otro juego podemos jugar?" se enrutaba al motor
 * activo y quedaba en un ciclo infinito.
 */
export const GAME_MENU_FRAMES: readonly string[] = Object.freeze([
    'otro juego',
    'otros juegos',
    'que otro juego',
    'que juegos hay',
    'que juegos podemos',
    'a que podemos jugar',
    'a que jugamos',
    'cambiar de juego',
    'cambiar el juego',
    'menu de juegos',
    'mas juegos',
    'otra cosa',
    'jugar otra cosa',
    'otra actividad',
    'algo mas',
]);

/**
 * Peticiones de INFORMACIÓN que NO son una respuesta del juego activo: las
 * responde la IA, no el motor (que entraría en ciclo repitiendo la pregunta).
 * Genérico para TODOS los juegos: el enrutador lo consulta igual para
 * cualquier partida activa.
 */
export const NON_GAME_REQUEST_FRAMES: readonly string[] = Object.freeze([
    'platicame',
    'platica',
    'cuentame',
    'hablame',
    'explicame',
    'dime sobre',
    'dime acerca',
    'dime de',
    'que sabes',
    'informacion sobre',
    'informacion de',
    'ensename',
    'habla sobre',
    'cuenta sobre',
    'explica sobre',
    'platicame sobre',
    'platicame de',
]);

// --- Catálogo (Fase 2: solo juegos implementados, sin dummies) ---

export const GAME_CATALOG: readonly GameIntentEntry[] = Object.freeze([
    {
        id: 'simon_dice',
        aliases: ['simon dice', 'simon dice dice', 'simon'],
        engine: createSimonDiceEngine,
        requiresApi: false,
    },
    {
        id: 'adivinanzas',
        aliases: ['adivinanzas', 'adivinanza', 'acertijos'],
        engine: createRiddlesEngine,
        requiresApi: false,
    },
    {
        id: 'veo_veo',
        aliases: ['veo veo', 'veo veo veo'],
        engine: createVeoVeoEngine,
        requiresApi: false,
    },
    {
        id: 'adivina_numero',
        aliases: ['adivina el numero', 'adivinar el numero', 'adivina que numero', 'adivina numero'],
        engine: createAdivinaNumeroEngine,
        requiresApi: false,
    },
    {
        id: 'calculo_mental',
        aliases: ['calculo mental', 'calculos mentales', 'matematicas', 'sumas y restas', 'sumas', 'a sumar', 'a restar', 'cuanto es'],
        engine: createCalculoMentalEngine,
        requiresApi: false,
    },
    {
        id: 'palabras_encadenadas',
        aliases: ['palabras encadenadas', 'cadena de palabras', 'encadenar palabras', 'palabras en cadena'],
        engine: createPalabrasEncadenadasEngine,
        requiresApi: false,
    },
    {
        id: 'quien_soy',
        aliases: ['quien soy', 'a quien soy', 'quien soy yo', 'adivina quien soy'],
        engine: createQuienSoyEngine,
        requiresApi: false,
    },
    {
        id: 'ahorcado',
        aliases: ['ahorcado', 'ahorcados', 'el ahorcado'],
        engine: createAhorcadoEngine,
        requiresApi: false,
    },
    {
        id: 'memoria_secuencias',
        aliases: ['memoria de secuencias', 'memoria', 'secuencias', 'memoria de colores'],
        engine: createMemoriaSecuenciasEngine,
        requiresApi: false,
    },
    {
        id: 'trabalenguas',
        aliases: ['trabalenguas', 'traba lenguas', 'trabalengua'],
        engine: createTrabalenguasEngine,
        requiresApi: false,
    },
    {
        id: 'trivia',
        aliases: ['trivia', 'trivias', 'preguntas y respuestas', 'preguntas', 'trivial'],
        engine: createTriviaEngine,
        requiresApi: false,
    },
    {
        id: 'ordena_secuencia',
        aliases: ['ordena la secuencia', 'ordenar secuencia', 'ordenar los pasos', 'ordena los pasos'],
        engine: createOrdenaSecuenciaEngine,
        requiresApi: false,
    },
    {
        id: 'adivina_cancion',
        aliases: ['adivina la cancion', 'que cancion es', 'adivina la melodia', 'adivinar la cancion', 'adivina que cancion'],
        engine: createAdivinaCancionEngine,
        requiresApi: false,
        audio: true,
    },
    {
        id: 'cuentacuentos',
        aliases: ['cuentacuentos', 'cuentame un cuento', 'cuentame una historia', 'una historia', 'un cuento'],
        engine: createCuentacuentosEngine,
        requiresApi: true,
    },
    {
        id: 'cuento_colaborativo',
        aliases: ['cuento colaborativo', 'hagamos un cuento', 'inventemos un cuento', 'cuento juntos'],
        engine: createCuentoColaborativoEngine,
        // 100% local (no implementa `narrate`): el flag `requiresApi` era falso.
        requiresApi: false,
    },
    {
        id: 'repite_traduce',
        aliases: ['repite y traduce', 'repite traduce', 'traduce', 'traducir palabras'],
        engine: createRepiteTraduceEngine,
        requiresApi: false,
    },
    {
        id: 'cuenta_conmigo',
        aliases: ['cuenta conmigo', 'contar conmigo', 'contemos juntos'],
        engine: createCuentaConmigoEngine,
        requiresApi: false,
    },
    {
        id: 'abecedario',
        aliases: ['abecedario', 'el abecedario', 'las letras', 'el alfabeto'],
        engine: createAbecedarioEngine,
        requiresApi: false,
    },
    {
        id: 'loteria',
        aliases: ['loteria', 'la loteria'],
        engine: createLoteriaEngine,
        requiresApi: false,
    },
    {
        id: 'respiracion',
        aliases: ['respira', 'respiracion', 'respiremos', 'ejercicio de respiracion', 'respirar'],
        engine: createRespiracionEngine,
        requiresApi: false,
    },
    {
        id: 'karaoke',
        aliases: ['karaoke', 'cantar juntos', 'cantemos', 'canta conmigo'],
        engine: createKaraokeEngine,
        requiresApi: false,
        audio: true,
        suppressAmbient: true,
    },
]);

export function matchGameIntent(text = ''): GameIntentEntry | null {
    const normalized = normalizeForMatch(text);
    if (!normalized) return null;

    // Guardia anti-negación: "no quiero jugar a..." nunca inicia.
    for (const negative of NEGATIVE_INTENT_FRAMES) {
        if (hasToken(normalized, negative)) return null;
    }

    // Requiere UN marco de intención de juego.
    let hasFrame = false;
    for (const frame of PLAY_INTENT_FRAMES) {
        if (hasToken(normalized, frame)) {
            hasFrame = true;
            break;
        }
    }
    if (!hasFrame) return null;

    // Y UN alias del juego (si hay varios, gana el más largo/primero).
    for (const entry of GAME_CATALOG) {
        for (const alias of entry.aliases) {
            if (hasToken(normalized, alias)) return entry;
        }
    }
    return null;
}

/**
 * Nombre visible de un juego (para menús): su primer alias, capitalizado.
 * Fuente única: el alias canónico del catálogo; sin lista de títulos aparte.
 */
export function gameDisplayName(entry: GameIntentEntry): string {
    const name = entry.aliases[0] || entry.id;
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Nombres visibles de todos los juegos, en orden del catálogo. */
export function gameMenuNames(): string[] {
    return GAME_CATALOG.map(gameDisplayName);
}

export function getGameEngine(id: GameId): GameEngine | null {
    const entry = GAME_CATALOG.find((candidate) => candidate.id === id);
    return entry ? entry.engine() : null;
}

/** ¿El juego reproduce audio (música)? Fuente única: el flag del catálogo. */
export function isAudioGame(id: GameId): boolean {
    return Boolean(GAME_CATALOG.find((entry) => entry.id === id)?.audio);
}

/** ¿Suprime la voz ambiente mientras suena el audio? (karaoke sí; adivina no). */
export function suppressesAmbient(id: GameId): boolean {
    return Boolean(GAME_CATALOG.find((entry) => entry.id === id)?.suppressAmbient);
}

export function isGameId(value: unknown): value is GameId {
    return typeof value === 'string' && (GAME_IDS as readonly string[]).includes(value);
}
