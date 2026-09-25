// ============================================================
// environmentPrompt.ts — Prompt de AMBIENTES para el LLM (datos)
// ============================================================
// FASE A: el LLM INTERPRETA la esencia de la orden y decide el
// ambiente (rol/oficio) que el usuario adopta. NO usa coincidencia
// literal de tokens: recibe el catálogo fusionado (built-ins +
// dinámicos de IndexedDB) como datos y devuelve el id exacto.
//
// Fuente de verdad ÚNICA: environmentRegistry (caché fusionada).
// Cero literales hardcodeados aquí: nombres, frases e ids salen
// del catálogo real. Si el catálogo está vacío, devuelve ''.
// ============================================================

import { getAmbientes, DEFAULT_AMBIENTE_ID } from './environmentRegistry';

/**
 * Construye el bloque de instrucciones de AMBIENTES para el system prompt.
 * Enlista el catálogo fusionado (built-ins + dinámicos) con sus frases de
 * activación en el idioma solicitado, e instruye al modelo a emitir el
 * campo `ambiente` SOLO cuando el usuario adopta explícitamente un rol
 * (y `DEFAULT_AMBIENTE_ID` para volver al asistente por defecto).
 *
 * @param language Idioma del prompt ('es' | 'en').
 * @returns Bloque de texto con las instrucciones ('' si no hay ambientes).
 */
export function buildAmbientePrompt(language: 'es' | 'en' = 'es'): string {
    const isEnglish = language === 'en';
    const ambientes = getAmbientes();

    if (!ambientes || ambientes.length === 0) {
        return '';
    }

    const catalogLine = `${isEnglish
        ? 'Available environments (id: name — example phrases):'
        : 'Ambientes disponibles (id: nombre — frases de ejemplo):'} ${ambientes
        .map((ambiente) => {
            const frases = ambiente.frasesActivacion[language] ?? [];
            const ejemplos = frases
                .slice(0, 2)
                .map((frase) => `"${frase}"`)
                .join(', ');
            const label = isEnglish ? 'examples' : 'ejemplos';
            return `- "${ambiente.id}" (${ambiente.nombre})${ejemplos ? ` ${label}: ${ejemplos}` : ''}`;
        })
        .join(' ')}.`;

    return [
        isEnglish
            ? 'You can use the "ambiente" field when the user explicitly adopts a role or profession.'
            : 'Puedes usar el campo "ambiente" cuando el usuario adopte explicitamente un rol u oficio.',
        isEnglish
            ? 'Emit ambiente ONLY when the user explicitly takes on a role (e.g. "act as a chef", "pretend you are a gardener"). If it is just a topic, an opinion, or no id matches, OMIT the field entirely.'
            : 'Emita ambiente SOLO cuando el usuario adopte explicitamente un rol (ej. "actua como chef", "hazte jardinero"). Si es solo un tema, una opinion, o ningun id coincide, OMITE el campo por completo.',
        isEnglish
            ? `To return to the default assistant, emit ambiente with the exact id "${DEFAULT_AMBIENTE_ID}".`
            : `Para volver al asistente por defecto, emite ambiente con el id exacto "${DEFAULT_AMBIENTE_ID}".`,
        catalogLine,
        isEnglish
            ? 'Use the EXACT id from the list. Do not invent ids.'
            : 'Usa el id EXACTO de la lista. No inventes ids.',
    ].join(' ');
}
