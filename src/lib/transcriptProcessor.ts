// ============================================================
// transcriptProcessor — Post-processing de Transcripts de Gemini
// ============================================================
// Gemini a menudo interpreta verbos de acción (baila, corre, canta)
// como estados emocionales en lugar de acciones físicas. Por ejemplo,
// "baila" → emocion: "Yupi" en lugar de animacion: "Dance".
//
// Este módulo permite interceptar el transcript del usuario y FORZAR
// la animación correcta, anulando lo que Gemini devuelva.
// Es un post-processing 100% confiable porque corre DESPUÉS de Gemini.
//
// También resuelve emociones específicas del transcript contra
// EXPRESSION_MAP para obtener las animaciones reales del avatar.
// ============================================================

import { BUNNY_ANIMATIONS, type BunnyAnimation } from '../avatar';

// ============================================================
// MAPA DE ACCIONES FÍSICAS — Post-processing de Gemini
// ============================================================
export const TRANSCRIPT_ACTION_MAP: Array<{
    keywords: string[];
    animacion: string;
}> = [
        { keywords: ['baila', 'bailar', 'bailando', 'dance', 'dancing'], animacion: 'Dance' },
        { keywords: ['corre', 'correr', 'corriendo', 'run', 'running'], animacion: 'Run' },
        { keywords: ['camina', 'caminar', 'caminando', 'walk', 'walking'], animacion: 'Walk' },
        { keywords: ['canta', 'cantar', 'cantando', 'sing', 'singing'], animacion: 'Dance' },
        { keywords: ['salta', 'saltar', 'saltando', 'jump', 'jumping'], animacion: 'Jump_in_place' },
        { keywords: ['escapa', 'escapar', 'escapando', 'escape', 'flee'], animacion: 'Walk_sneaky' },
        // OREJAS / OJOS / MANOS — acciones corporales directas (FIX 3)
        { keywords: ['baja las orejas', 'bajar las orejas', 'bajando las orejas', 'baja tus orejas', 'bajar tus orejas', 'lower your ears', 'lower ears', 'ears back'], animacion: 'Cap_back' },
        { keywords: ['orejas al frente', 'orejas hacia adelante', 'orejas para adelante', 'ears forward'], animacion: 'Cap_front' },
        { keywords: ['cierra los ojos', 'cerrar los ojos', 'cerrando los ojos', 'cierra tus ojos', 'cierra los ojitos', 'close your eyes', 'close your eye', 'blink'], animacion: 'Emo_blink' },
        { keywords: ['mueve las manos', 'mover las manos', 'mueve tus manos', 'moviendo las manos', 'mover los brazos', 'mueve los brazos', 'move your hands', 'wave your hands'], animacion: 'Palabra' },
    ];

// ============================================================
// MAPA DE EMOCIONES — Post-processing de Gemini
// ============================================================
// Gemini frecuentemente ignora las expresiones emocionales
// específicas ("chispas", "se_me_chispotio") y devuelve
// emociones genéricas ("feliz", "serio") en su lugar.
//
// Este mapa permite interceptar el transcript y FORZAR la
// emoción correcta según palabras clave del usuario.
// ============================================================
export const TRANSCRIPT_EMOTION_MAP: Array<{
    keywords: string[];
    emocion: string;
}> = [
        // NOTA: El orden importa — se_me_chispotio debe ir ANTES que chispas
        // porque "chispoteo"/"chispotio" son substrings de "se me chispoteó"/"se me chispotió"
        { keywords: ['se me chispotio', 'se me chispoteo', 'se me fue', 'se me olvido', 'se me pasó', 'se me paso', 'perdon', 'lo siento', 'disculpa'], emocion: 'se_me_chispotio' },
        { keywords: ['chispas', 'chispa', 'ups', 'oops'], emocion: 'chispas' },
        { keywords: ['palabra', 'participar', 'quiero hablar', 'quiero participar', 'quiero opinar', 'quiero decir', 'intervenir', 'opinar', 'decir algo', 'participación', 'participacion'], emocion: 'palabra' },
        { keywords: ['llorando', 'llora', 'llorar', 'crying', 'cry', 'weeping', 'weep'], emocion: 'llorando' },
        { keywords: ['triste', 'tristeza', 'triste', 'sad', 'depressed', 'deprimido', 'melancolico', 'melancólico'], emocion: 'triste' },
        { keywords: ['serio', 'seria', 'seriedad', 'serious', 'grave', 'formal'], emocion: 'serio' },
        { keywords: ['feliz', 'contento', 'contenta', 'alegre', 'happy', 'glad', 'joy', 'felicidad'], emocion: 'feliz' },
        { keywords: ['enojado', 'enojada', 'enojar', 'molesto', 'molesta', 'enfadado', 'enfadada', 'furioso', 'furiosa', 'ira', 'angry', 'mad', 'upset'], emocion: 'enojado' },
        { keywords: ['sorprendido', 'sorprendida', 'sorprender', 'sorpresa', 'asombrado', 'asombrada', 'surprised', 'surprise', 'astonished', 'amazed'], emocion: 'sorprendido' },
    ];

// ============================================================
// Funciones de detección
// ============================================================

/**
 * Detecta si el transcript del usuario contiene una acción física
 * y retorna la animación correspondiente, o null si no hay acción.
 */
export function detectActionInTranscript(transcript: string): string | null {
    const lower = transcript.toLowerCase().trim();
    for (const entry of TRANSCRIPT_ACTION_MAP) {
        for (const kw of entry.keywords) {
            if (lower.includes(kw)) {
                return entry.animacion;
            }
        }
    }
    return null;
}

/**
 * Detecta si el transcript del usuario contiene una palabra clave
 * emocional y retorna la emoción correspondiente, o null si no hay.
 */
export function detectEmotionInTranscript(transcript: string): string | null {
    const lower = transcript.toLowerCase().trim();
    for (const entry of TRANSCRIPT_EMOTION_MAP) {
        for (const kw of entry.keywords) {
            if (lower.includes(kw)) {
                return entry.emocion;
            }
        }
    }
    return null;
}

/**
 * Resuelve un emotionLabel contra EXPRESSION_MAP para obtener
 * las animaciones reales del avatar (BunnyAnimation[]).
 * Busca primero en EXPRESSION_MAP, luego en TRANSCRIPT_ACTION_MAP
 * como fallback inverso.
 */
export function resolveEmotionAnims(
    emotionLabel: string,
    expressionMap: Record<string, BunnyAnimation[]>,
): BunnyAnimation[] | undefined {
    // Label directo de animación válida (Cap_back, Emo_blink, Walk…):
    // aplicarlo tal cual, sin caer en el fallback que lo mapea a 'enojado'.
    if (BUNNY_ANIMATIONS.includes(emotionLabel as BunnyAnimation)) {
        return [emotionLabel as BunnyAnimation];
    }
    // Buscar primero en EXPRESSION_MAP (claves como 'baila', 'se_me_chispotio')
    let resolvedAnims = expressionMap[emotionLabel];
    if (!resolvedAnims) {
        // Fallback: buscar en TRANSCRIPT_ACTION_MAP por animacion
        const actionEntry = TRANSCRIPT_ACTION_MAP.find(e => e.animacion === emotionLabel);
        if (actionEntry) {
            // Buscar la clave inversa en EXPRESSION_MAP cuyo valor contenga la animación
            for (const [key, anims] of Object.entries(expressionMap)) {
                if (anims.includes(emotionLabel as BunnyAnimation)) {
                    resolvedAnims = expressionMap[key];
                    break;
                }
            }
        }
    }
    return resolvedAnims;
}
