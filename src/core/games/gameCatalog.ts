// ============================================================
// src/core/games/gameCatalog.ts
// Catálogo data-driven de intenciones de juego (plan-juegos §3).
// Estilo de voiceConfigCatalog.ts y de los NOUN_PAIRS de
// configCommands.js. Módulo autónomo (helpers locales de
// normalización; sin imports .js para evitar riesgo de resolución).
//
// GUARDIA TRIPLE: para pedir un juego se requiere UNA orden de
// juego (arranque PLAY_INTENT_FRAMES o cambio CHANGE_GAME_FRAMES)
// Y UN alias del juego.
// "simón dice que te calles" NO dispara (falta el marco).
// "ok flu, vamos a jugar a las adivinanzas" → adivinanzas.
// "cambia a trivia" → trivia (cambio con la partida en curso).
// ============================================================
import type { GameEngine } from './gameEngine.ts';
import type { GameId } from './types.ts';
import { NEGATIVE_INTENT_FRAMES, hasGameOrderFrame, hasToken, normalizeForMatch, turnResult } from './gameUtils.ts';
import { createSimonDiceEngine } from './simonDice.ts';
import { createRiddlesEngine } from './riddles.ts';
import { createVeoVeoEngine } from './veoVeo.ts';
import { createAdivinaNumeroEngine } from './adivinaNumero.ts';
import { createCalculoMentalEngine } from './calculoMental.ts';
import { createPalabrasEncadenadasEngine } from './palabrasEncadenadas.ts';
import { createQuienSoyEngine } from './quienSoy.ts';
import { createAhorcadoEngine } from './ahorcado.ts';
import { createMemoriaSecuenciasEngine } from './memoriaSecuencias.ts';
import { createTrabalenguasEngine } from './trabalenguas.ts';
import { createTriviaEngine } from './trivia.ts';
import { createOrdenaSecuenciaEngine } from './ordenaSecuencia.ts';
import { createAdivinaCancionEngine } from './adivinaCancion.ts';
import { createCuentacuentosEngine } from './storyteller.ts';
import { createCuentoColaborativoEngine } from './cuentoColaborativo.ts';
import { createRepiteTraduceEngine } from './repiteTraduce.ts';
import { createCuentaConmigoEngine } from './cuentaConmigo.ts';
import { createAbecedarioEngine } from './abecedario.ts';
import { createLoteriaEngine } from './loteria.ts';
import { createRespiracionEngine } from './respiracion.ts';
import { createKaraokeEngine } from './karaoke.ts';
import { createPronunciacionEngine } from './pronunciacion.ts';

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
    'abecedario', 'loteria', 'respiracion', 'karaoke', 'pronunciacion',
  ]);

// --- Tokenización local (sin dependencias) ---





// --- Guardias (data-driven) ---


/**
 * Frases de salida de una partida activa.
 * DUENO UNICO: viven en gameUtils (hoja sin imports) porque las consumen por
 * igual el fast-path de voz y los 21 motores. Aqui solo se re-exportan para no
 * romper la superficie publica del catalogo.
 */
export { END_GAME_FRAMES } from './gameUtils.ts';

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
    {
        id: 'pronunciacion',
        aliases: ['pronunciacion', 'pronunciation', 'practicar pronunciacion', 'practica de pronunciacion'],
        engine: createPronunciacionEngine,
        requiresApi: false,
    },
]);

export function matchGameIntent(text = ''): GameIntentEntry | null {
    const normalized = normalizeForMatch(text);
    if (!normalized) return null;
    if (hasNegativeIntent(normalized)) return null;

    // Requiere UNA ORDEN DE JUEGO (arranque "vamos a jugar X" o cambio "cambia a
    // X") Y UN alias del juego. "simón dice que te calles" NO dispara (sin marco).
    if (!hasGameOrderFrame(normalized)) return null;
    return bestAliasMatch(
        (alias) => hasToken(normalized, alias) || matchesTruncatedAliasTail(normalized, alias, false),
    );
}

/**
 * Match EXACTO por NOMBRE de juego, sin marco de intención.
 *
 * Caso real (portal 11:27): FLU ofrece el menú ("¿A cuál te gustaría jugar?") y el
 * niño responde solo con el nombre ("cuenta conmigo"). Sin marco, NINGÚN dominio lo
 * resolvía y la IA SIMULABA el arranque ("¡Claro! Iniciamos el juego 'Cuenta
 * conmigo'.") sin partida real: después el juego no respondía nada.
 *
 * Solo acepta el nombre PELADO (artículo opcional) para no arrancar partidas con
 * frases de conversación. Con partida activa NO debe usarse como "el juego manda":
 * el motor conserva la prioridad sobre sus propios comandos.
 */
const LEADING_ARTICLE_RE = /^(?:el|la|los|las|un|una)\s+/;

/**
 * Palabras de un texto ya NORMALIZADO. `normalizeForMatch` colapsa los espacios
 * pero NO quita la puntuacion, asi que aqui se recorta la de los bordes (es la
 * misma clase de limite que `findTokenIndex` ya trata: `.,;!?` y los signos de
 * apertura). Los alias del catalogo son palabras limpias; esto solo limpia lo
 * que llega del ASR ("¿quien soy?" -> "quien", "soy").
 */
function wordsOf(value: string): string[] {
    return value
        .split(' ')
        .map((word) => word.replace(/[.,;!?¡¿"'()[\]]/g, ''))
        .filter(Boolean);
}

/**
 * CORTE DEL ASR AL FINAL DEL NOMBRE. Defecto de clase medido (2026-09-22): el
 * dictado pierde el final de la ULTIMA palabra del nombre ("quien so" por
 * "quien soy", "loteri" por "loteria", "trivi" por "trivia") y el nombre deja de
 * existir: en la ruta pelada el turno cae al LLM (que simula el arranque) y con
 * marco el dueno responde "ese juego no lo tengo" a un juego que SI tiene. Antes
 * de este arreglo, 97 cortes (de 1 y 2 letras) rompian la decision en los 21
 * juegos del catalogo.
 *
 * Reglas (medidas, no esteticas):
 *  - El corte cae SIEMPRE al final de la locucion, asi que solo se tolera en la
 *    ULTIMA palabra y solo si el alias queda al final del texto.
 *  - NO se pueden perder palabras enteras: el numero de palabras debe ser el del
 *    alias. Sin esto, "quien" (arranque interrogativo) arrancaria el juego y
 *    volveria el defecto P7.58.
 *  - El corte tolerado es de hasta CORTE_MAX_PALABRA letras: es la magnitud
 *    medida del ASR (el guard de ruido G7 corta exactamente 2).
 *  - Con DOS o mas palabras, las anteriores van EXACTAS y completas: ese contexto
 *    identifica el nombre aunque la ultima quede en una sola letra ("quien s").
 *  - Con UNA sola palabra no hay contexto, asi que ademas hay que conservar
 *    MIN_LETRAS_UNA_PALABRA: es lo que evita que "cuenta" arranque cuentacuentos
 *    o "adivina" arranque adivinanzas.
 */
const CORTE_MAX_PALABRA = 2;
const MIN_LETRAS_UNA_PALABRA = 4;

function matchesTruncatedAliasTail(normalized: string, alias: string, wholeText: boolean): boolean {
    const said = wordsOf(normalized);
    const words = wordsOf(alias);
    if (!words.length || said.length < words.length) return false;
    if (wholeText && said.length !== words.length) return false;
    const tail = said.slice(said.length - words.length);
    const last = words.length - 1;
    for (let i = 0; i < last; i += 1) {
        if (tail[i] !== words[i]) return false;
    }
    const dicho = tail[last];
    const entera = words[last];
    if (dicho === entera || !entera.startsWith(dicho)) return false;
    if (entera.length - dicho.length > CORTE_MAX_PALABRA) return false;
    if (words.length === 1 && dicho.length < MIN_LETRAS_UNA_PALABRA) return false;
    return true;
}

export function matchGameAliasOnly(text = ''): GameIntentEntry | null {
    const normalized = normalizeForMatch(text).replace(LEADING_ARTICLE_RE, '').trim();
    if (!normalized) return null;
    if (hasNegativeIntent(normalized)) return null;
    return bestAliasMatch(
        (alias) => normalized === alias || matchesTruncatedAliasTail(normalized, alias, true),
    );
}

/** Guardia anti-negacion: "no quiero jugar a..." nunca inicia/cambia. */
function hasNegativeIntent(normalized: string): boolean {
    return NEGATIVE_INTENT_FRAMES.some((negative) => hasToken(normalized, negative));
}
/**
 * Es el texto una NEGACION de juego? ("no quiero jugar a X").
 *
 * Se exporta porque el dueno de la frase "el catalogo no tiene ese juego" necesita
 * distinguir una ORDEN de una NEGACION: "no quiero jugar a adivina quien" no puede
 * responder con el catalogo. Dueno UNICO de la lista: NEGATIVE_INTENT_FRAMES.
 */
export function hasNegativeGameIntent(text = ''): boolean {
    const normalized = normalizeForMatch(text);
    if (!normalized) return false;
    return hasNegativeIntent(normalized);
}

/**
 * Elige el juego cuyo alias casa (dueño ÚNICO de la selección). Si casa más de
 * uno gana el MÁS LARGO, que es el MÁS específico: "hagamos un cuento" es
 * cuento_colaborativo, no el alias genérico "un cuento" de cuentacuentos.
 * Empate → orden del catálogo (estable).
 */
function bestAliasMatch(
    matches: (alias: string) => boolean,
): GameIntentEntry | null {
    let best: GameIntentEntry | null = null;
    let bestLength = -1;
    for (const entry of GAME_CATALOG) {
        for (const alias of entry.aliases) {
            if (!matches(alias)) continue;
            if (alias.length > bestLength) {
                best = entry;
                bestLength = alias.length;
            }
        }
    }
    return best;
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

/**
 * Una ORDEN DE ARRANQUE/CAMBIO ("vamos a jugar X", "cambia a X") NUNCA es una
 * jugada del jugador. El fast-path ya no la despacha como turno, pero el ECO del
 * ASR puede llegar al motor por la via directa (misma clase de defecto que el
 * doble dueno de la voz), y ahi el motor la consumia como jugada: medido con
 * semillas fijas en G7, `palabras_encadenadas` terminaba la partida declarando
 * ganador al jugador con UNA sola jugada, y `memoria_secuencias`/`abecedario`/
 * `respiracion` sumaban un punto y una ronda que nadie habia dado. El muro vive
 * AQUI, en el unico sitio por el que pasan los 21 motores, para no repetir la
 * regla en 21 ficheros: el marco de arranque tiene UN dueno (`hasGameOrderFrame`).
 * Devuelve "sin decision": no habla (prompt vacio, misma convencion que
 * resolveDeterministicCourtesySpeech) y no toca la partida.
 */
function withStartOrderWall(engine: GameEngine): GameEngine {
    const turn = engine.turn.bind(engine);
    return {
        ...engine,
        turn(session, text = '', context) {
            if (hasGameOrderFrame(normalizeForMatch(text))) {
                return turnResult('', session.score, { error: 'orden de arranque, no una jugada' });
            }
            return turn(session, text, context);
        },
    };
}

export function getGameEngine(id: GameId): GameEngine | null {
    const entry = GAME_CATALOG.find((candidate) => candidate.id === id);
    return entry ? withStartOrderWall(entry.engine()) : null;
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
