// ============================================================
// tutoringModel - Modelo de TUTORIA: areas y la regla de pedagogia.
// ------------------------------------------------------------
// DUENO UNICO de dos cosas que antes no existian y por eso la tutoria
// dependia por completo del modelo:
//   1. El VOCABULARIO de areas (una etiqueta, un sitio). Las areas son
//      ABIERTAS ("mejorar en cualquier area"): se reconocen las conocidas y
//      cualquier otra etiqueta se admite tal cual, con su id normalizado.
//   2. La CONSULTA de avance por area ("¿como voy en ingles?"), que es lo que
//      permite responder con el avance REAL guardado en las minutas en vez de
//      que la IA lo invente.
// Al lado (tutoringProgress) vive la DERIVACION del avance a partir de las
// minutas: no hay tabla nueva ni segundo almacen (AGENTS 7.7.c).
// ============================================================
import { normalizeForMatch, normalizeSpaces } from '../../lib/textUtils';
import { slugifyPalette } from '../branding/paletaFactory';

/** Area de tutoria: id canonico (sin diacriticos, para comparar) + etiqueta legible. */
export interface TutoringArea {
    id: string;
    label: string;
}

/**
 * Areas conocidas: id canonico, etiqueta para hablar y sinonimos aceptados.
 * Anadir un area es anadir una fila AQUI (nadie mas enumera areas).
 * El sinonimo se compara en minusculas y sin diacriticos.
 */
const KNOWN_AREAS: ReadonlyArray<TutoringArea & { aliases: readonly string[] }> = Object.freeze([
    { id: 'ingles', label: 'Inglés', aliases: ['ingles', 'english', 'ingles conversacional'] },
    { id: 'matematicas', label: 'Matemáticas', aliases: ['matematicas', 'matematica', 'mates', 'math', 'maths'] },
    { id: 'historia', label: 'Historia', aliases: ['historia', 'history'] },
    { id: 'ciencias', label: 'Ciencias', aliases: ['ciencias', 'ciencia', 'science'] },
    { id: 'fisica', label: 'Física', aliases: ['fisica', 'physics'] },
    { id: 'quimica', label: 'Química', aliases: ['quimica', 'chemistry'] },
    { id: 'lectura', label: 'Lectura', aliases: ['lectura', 'comprension lectora', 'reading'] },
    { id: 'escritura', label: 'Escritura', aliases: ['escritura', 'writing', 'redaccion'] },
    { id: 'programacion', label: 'Programación', aliases: ['programacion', 'codigo', 'programming', 'coding'] },
    { id: 'arte', label: 'Arte', aliases: ['arte', 'dibujo', 'pintura', 'art'] },
    { id: 'musica', label: 'Música', aliases: ['musica', 'music', 'solfeo'] },
]);

/** Palabras que anuncian una consulta de AVANCE (no una simple charla). */
const PROGRESS_QUERY_PATTERNS: readonly RegExp[] = Object.freeze([
    /\b(?:como|que tal|cuanto)\s+(?:voy|vamos|he avanzado|avance)\b/i,
    /\b(?:mi|el)\s+(?:avance|progreso)\b/i,
    /\b(?:avance|progreso)\s+en\b/i,
    /\bhow\s+(?:am\s+i|are\s+we)\s+doing\b/i,
    /\b(?:my|the)\s+progress\b/i,
    /\bprogress\s+in\b/i,
]);

function norm(value: unknown): string {
    return normalizeForMatch(String(value ?? '')).replace(/\s+/g, ' ').trim();
}

/** id de un area libre: delega en el slug UNICO del repo (slugifyPalette). */
export function slugTutoringArea(label: string = ''): string {
    return slugifyPalette(normalizeSpaces(label));
}

/**
 * Area canonica de una etiqueta libre: las conocidas devuelven su id/etiqueta
 * oficiales; cualquier otra se admite (mismo texto, id normalizado). `null` si
 * la etiqueta esta vacia.
 */
export function resolveTutoringArea(label: string = ''): TutoringArea | null {
    const raw = normalizeSpaces(label);
    const key = norm(raw);
    if (!key) return null;
    const known = KNOWN_AREAS.find((area) => area.id === key || area.aliases.includes(key));
    if (known) return { id: known.id, label: known.label };
    return { id: slugTutoringArea(raw) || key, label: raw };
}

/**
 * ¿El texto MENCIONA el area? Compara por palabra completa (no confunde "arte"
 * dentro de "apartamento") usando los sinonimos conocidos del area y, para un
 * area libre, su etiqueta y su id.
 */
export function mentionsTutoringArea(text: string = '', area: TutoringArea | null): boolean {
    const normalized = norm(text);
    if (!normalized || !area) return false;
    const known = KNOWN_AREAS.find((item) => item.id === area.id);
    const needles = known ? [known.id, ...known.aliases] : [area.id, slugTutoringArea(area.label)];
    return needles.filter(Boolean).some((needle) =>
        new RegExp(`(^|[^a-z0-9])${needle.replace(/[-\s]+/g, '[- ]')}($|[^a-z0-9])`).test(normalized),
    );
}

/** Area CONOCIDA mencionada en un texto (o `null`). */
export function findKnownTutoringArea(text: string = ''): TutoringArea | null {
    for (const area of KNOWN_AREAS) {
        const candidate = { id: area.id, label: area.label };
        if (mentionsTutoringArea(text, candidate)) return candidate;
    }
    return null;
}

/**
 * Consulta de AVANCE por area: "¿como voy en ingles?", "mi avance en
 * matematicas", "how am I doing in English". Devuelve el area o `null` si el
 * texto no es una consulta de avance (asi no se secuestra una charla normal).
 */
export function parseTutoringProgressQuery(text: string = ''): TutoringArea | null {
    const normalized = norm(text);
    if (!normalized) return null;
    if (!PROGRESS_QUERY_PATTERNS.some((pattern) => pattern.test(normalized))) return null;
    const known = findKnownTutoringArea(normalized);
    if (known) return known;
    // Area libre: lo que sigue a "en ..." ("como voy en origami").
    const free = normalized.match(/\b(?:en|in)\s+([a-z0-9][a-z0-9 -]{1,30}?)[\s?.!,]*$/);
    return free ? resolveTutoringArea(free[1]) : null;
}

/** ¿El texto es una consulta de avance de tutoria? (dueño unico de la pregunta). */
export function isTutoringProgressQuery(text: string = ''): boolean {
    return parseTutoringProgressQuery(text) !== null;
}

/**
 * Regla de PEDAGOGIA para el prompt (una sola fuente; la consume el catalogo de
 * capacidades). No promete una accion de contrato: ensenar es conversar, con
 * un metodo fijo, y el avance se deduce de las minutas de la sesion.
 */
export function buildTutoringRule(language: 'es' | 'en' = 'es'): string {
    if (language === 'en') {
        return 'TUTORING RULE: when the user asks you to learn, practice or improve something (English conversation, math, history, anything), you are the TUTOR of that area and you teach with this method: (1) find out the level with ONE short question; (2) explain in short steps, one idea at a time; (3) ask the student to PRACTICE and wait for the answer; (4) correct: give the corrected version and why, in one line; (5) close with ONE next step. Speak the language being practiced (English practice is answered in English); if the student asks for a translation or a doubt, answer it briefly in their own language and return to practice. NEVER say you did something you did not do, and never dump a whole lesson in one turn.';
    }
    return 'REGLA DE TUTORÍA: cuando el usuario te pida aprender, practicar o mejorar algo (conversación en inglés, matemáticas, historia, cualquier área), tú eres el TUTOR de esa área y enseñas con este método: (1) averigua el nivel con UNA pregunta corta; (2) explica en pasos cortos, una idea a la vez; (3) pide al alumno que PRACTIQUE y espera su respuesta; (4) corrige: da la versión corregida y el por qué, en una línea; (5) cierra con UN siguiente paso. Habla el idioma que se está practicando (la práctica de inglés se responde en inglés); si el alumno pide una traducción o pregunta una duda, resuélvela breve en su idioma y vuelve a la práctica. NUNCA digas que hiciste algo que no hiciste, y no sueltes una clase entera en un turno.';
}
