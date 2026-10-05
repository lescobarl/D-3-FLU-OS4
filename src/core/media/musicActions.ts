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
// VOCABULARIO de MUSICA por TEXTO. Aqui vive la UNICA tabla y las DOS preguntas
// que se derivan de ella:
//   - isMusicRequestText: "es una peticion o control de musica?" (para que un
//     juego activo no se coma el turno: regla 19 de AGENTS.md).
//   - resolveMusicIntent: "que accion pide (poner/parar/pausar) y que cancion?".
//
// MOTIVO (medido dos veces, no supuesto): la EJECUCION no puede quedar a merced
// del LLM. En P8.53 los marcos de control existian SOLO como guardia de reclamo y
// el modelo respondio "Alto." a "okay flow alto" sin detener nada. En P8.56 hizo lo
// mismo con la reproduccion: a "canta la cancion de Las mananitas" contesto
// "Claro, poniendo Las Mananitas" SIN emitir el campo 'musica' (en el relay de la
// app no hay ninguna linea [Musica] play_music) mientras seguia sonando otra pista.
//
// MODOS DE ACIERTO, una sola tabla:
//   - SUBCADENA (MUSIC_CONTROL_FRAMES): marcos que llevan su objeto ("para la musica").
//   - GRAMATICA (verbo + objeto): el mandato EMPIEZA por un verbo de musica y sigue su
//     objeto ("pon musica", "canta la cancion de X"); lo que queda DESPUES del objeto es
//     el NOMBRE de la cancion. Exigir el objeto evita los dos falsos positivos medidos:
//     "pon la mesa" no es musica y "canta otra" es una orden de la LOTERIA (su
//     NEXT_FRAMES), no una cancion llamada "otra".
//   - PALABRA SUELTA de parada (MUSIC_STOP_WORDS, con o sin objeto de musica): son
//     ambiguas ("alto" tambien es "alto de estatura"), asi que exigen el mandato entero.
// ------------------------------------------------------------------
/** Verbo de la orden de musica. Debe ir seguido del OBJETO de musica. */
const MUSIC_PLAY_VERBS: readonly string[] = Object.freeze([
    'quiero escuchar',
    'quiero oir',
    'reproduceme',
    'cantame',
    'cantanos',
    'reproduce',
    'escucha',
    'ponme',
    'ponnos',
    'tocame',
    'canta',
    'dame',
    'toca',
    'pon',
]);

/** Objeto de musica que debe acompanar al verbo. El NOMBRE de la cancion va DESPUES. */
const MUSIC_OBJECTS: readonly string[] = Object.freeze([
    'la cancion de',
    'una cancion de',
    'la musica de',
    'un poco de musica',
    'algo de musica',
    'esta cancion',
    'estas canciones',
    'las canciones',
    'la cancion',
    'una cancion',
    'la musica',
    'musica de',
    'la melodia',
    'una melodia',
    'cancion de',
    'melodia',
    'musica',
    'cancion',
]);

/** Objetos que pueden acompanar a una palabra de parada sin cambiarle el dueno. */
const MUSIC_STOP_OBJECTS: readonly string[] = Object.freeze([
    'a la musica',
    'la musica',
    'a la cancion',
    'la cancion',
    'a las canciones',
    'las canciones',
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
 * Palabras SUELTAS de parada: solo cuentan cuando el mandato ENTERO es la palabra
 * (o la palabra + el objeto de la musica). "alto" es ambigua, asi que `includes`
 * detendria la musica con una frase que no la pide ("habla mas alto"). `alto` y
 * `stop` ya son salidas cortas del vocabulario de partida (gameUtils.END_GAME_FRAMES,
 * por token): con una partida activa el paso 1 del enrutador de juego las resuelve
 * como `end` ANTES que este modulo, asi que el juego se sigue cerrando con la misma
 * palabra y ademas se detiene la musica.
 */
const MUSIC_STOP_WORDS: readonly string[] = Object.freeze(['alto', 'stop']);

/** Quita la puntuacion de los bordes: "Alto!" -> "alto". */
function sinPuntuacionBordes(norm: string): string {
    return norm.replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '');
}

/** El texto empieza por la frase completa ("pon musica" si, "ponme" no). */
function empiezaPor(norm: string, frase: string): boolean {
    return norm === frase || norm.startsWith(`${frase} `);
}

/** El mandato ENTERO es una palabra de parada, con o sin el objeto de la musica. */
function esParada(norm: string): boolean {
    const t = sinPuntuacionBordes(norm).replace(/ por favor$/, '');
    if (MUSIC_STOP_WORDS.includes(t)) return true;
    return MUSIC_STOP_OBJECTS.some(
        (obj) => t.endsWith(` ${obj}`) && MUSIC_STOP_WORDS.includes(t.slice(0, -(obj.length + 1)).trim()),
    );
}

/** Intencion de musica resuelta por el dueno del vocabulario. */
export interface MusicIntent {
    accion: MusicAction;
    /** Cancion pedida (solo en `play_music`); ausente = pista ambiental del catalogo. */
    cancion?: string;
}

/** Reproduccion: verbo al principio + objeto de musica. Lo que sigue al objeto es el nombre. */
function resolverReproduccion(norm: string): MusicIntent | null {
    for (const verb of MUSIC_PLAY_VERBS) {
        if (!empiezaPor(norm, verb)) continue;
        const resto = norm.slice(verb.length).trim();
        const objeto = MUSIC_OBJECTS.find((obj) => empiezaPor(resto, obj));
        // Sin objeto de musica no hay peticion de musica: "pon la mesa", "canta otra".
        if (!objeto) return null;
        const nombre = resto.slice(objeto.length).trim();
        return { accion: 'play_music', ...(nombre ? { cancion: nombre } : {}) };
    }
    return null;
}

/**
 * Accion de musica pedida por el texto, con la cancion cuando la nombra.
 * DUENO UNICO de la decision (la tabla de arriba).
 */
export function resolveMusicIntent(text: unknown): MusicIntent | null {
    const norm = normalizeForMatch(String(text ?? ''));
    if (!norm) return null;
    if (esParada(norm)) return { accion: 'stop_music' };
    for (const control of MUSIC_CONTROL_FRAMES) {
        if (control.frames.some((frame) => norm.includes(frame))) return { accion: control.accion };
    }
    return resolverReproduccion(norm);
}

/**
 * Marcadores de RECLAMO: verbo + objeto, derivados de las mismas tablas. NO es el
 * verbo suelto a proposito, porque el reclamo se hace por SUBCADENA y recibe la
 * frase CRUDA (con la wake delante): "canta otra" es una orden de la LOTERIA
 * (loteria NEXT_FRAMES) y reclamarla romperia una jugada ya validada.
 */
const MUSIC_REQUEST_MARKERS: readonly string[] = Object.freeze([
    ...MUSIC_PLAY_VERBS.flatMap((verb) => MUSIC_OBJECTS.map((obj) => `${verb} ${obj}`)),
    ...MUSIC_CONTROL_FRAMES.flatMap((control) => control.frames),
]);

/** true si el texto es una PETICION o CONTROL de musica (por tanto, no una jugada). */
export function isMusicRequestText(text: unknown): boolean {
    const norm = normalizeForMatch(String(text ?? ''));
    if (!norm) return false;
    if (esParada(norm)) return true;
    return MUSIC_REQUEST_MARKERS.some((marker) => norm.includes(marker));
}

/**
 * Frase del TURNO de musica (una sola fuente, es/en). La dice el dueno
 * determinista: antes el fast-path era MUDO y el turno hablado quedaba en manos
 * del LLM, que contestaba "Alto." a "alto" aunque la musica SI se detuviera
 * (defecto medido en el log del dueno, P8.55).
 */
export function musicActionSpeech(accion: MusicAction, language: string = 'es'): string {
    const isEnglish = language === 'en';
    if (accion === 'stop_music') return isEnglish ? 'Music stopped.' : 'Música detenida.';
    if (accion === 'pause_music') return isEnglish ? 'Music paused.' : 'Música en pausa.';
    return isEnglish ? 'Playing music.' : 'Pongo la música.';
}
