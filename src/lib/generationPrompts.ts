// ============================================================
// generationPrompts.ts — prompts de generación (F3/F4)
// ============================================================
// El LLM produce el CONTENIDO; la capa de adaptadores
// (formatAdapters) solo serializa. Este módulo centraliza la
// construcción de prompts para generar documentos y guiones de
// video, manteniendo la lógica pura y testeable.
//
// Rule #1: NO HARDCODE → los formatos/instrucciones de contenido
// se derivan del tipo de formato solicitado (GenerationInput).
// ============================================================

import type { GenerationInput } from '../core/ai/IAIService';
import type { GenerationFormato } from '../types/documentContracts';

/** Instrucción de formato del contenido que debe devolver el LLM por tipo de formato. */
function formatContentInstruction(formato: GenerationFormato): string {
    switch (formato) {
        case 'xlsx':
            return 'Devuelve SOLO JSON válido con el formato: {"sheets": [{"name": string, "rows": [[string|number, ...], ...]}], "notas": string}. Las filas son arrays de celdas; la primera fila de cada hoja debe ser el encabezado.';
        case 'pptx':
            return 'Devuelve el contenido como markdown de diapositivas: cada diapositiva comienza con "# Título" seguido de viñetas "- punto". Máximo 8 diapositivas.';
        case 'pdf':
            return 'Devuelve el contenido como markdown estructurado (encabezados #, ## y viñetas).';
        case 'docx':
            return 'Devuelve el contenido como markdown estructurado (encabezados #, ## y viñetas), apto para un documento formal.';
        case 'csv':
            return 'Devuelve SOLO texto CSV con separador de punto y coma (;), con la primera fila de encabezados.';
        case 'json':
            return 'Devuelve SOLO JSON válido y bien formado.';
        case 'ics':
            return 'Devuelve SOLO un calendario ICS válido (VCALENDAR/VEVENT).';
        case 'html':
            return 'Devuelve SOLO HTML completo y válido (documento autocontenido con <html><head><body>).';
        case 'video':
            return 'Devuelve el guion como markdown: "# Título" + secciones "## Escena N" + líneas de narración y notas de visuales.';
        case 'md':
        default:
            return 'Devuelve el contenido como markdown estructurado y ejecutivo.';
    }
}

/** Prompt de sistema para generación de contenido. */
export function buildGenerationSystemPrompt(language = 'es'): string {
    return language === 'en'
        ? 'You are FLU, a document-generation assistant. Produce precise, executive content following the requested format exactly.'
        : 'Eres FLU, un asistente de generación de documentos. Produce contenido preciso y ejecutivo siguiendo exactamente el formato solicitado.';
}

/** Prompt de usuario para generación de contenido a partir de fuentes/parámetros. */
export function buildGenerationPrompt(payload: GenerationInput, language = 'es'): string {
    const langInstr = language === 'en' ? 'Respond in English only.' : 'Responde únicamente en español.';
    const fuentes = Array.isArray(payload.fuentes) && payload.fuentes.length
        ? payload.fuentes.map((f, i) => `${i + 1}. [${f.tipo}] ${f.ref}`).join('\n')
        : 'Ninguna fuente explícita (genera contenido general).';
    const params = payload.parametros || {};
    const paramsLine = [
        params.tema ? `Tema: ${params.tema}` : null,
        params.calidad ? `Calidad: ${params.calidad}` : null,
        params.duracion_min ? `Duración objetivo: ${params.duracion_min} min` : null,
        params.orientacion ? `Orientación: ${params.orientacion}` : null,
    ].filter(Boolean).join(' | ') || 'Sin parámetros adicionales';
    return [
        `Genera el contenido para un documento en formato "${payload.formato}". ${langInstr}`,
        ``,
        `Fuentes de contenido:`,
        fuentes,
        ``,
        `Parámetros: ${paramsLine}`,
        ``,
        formatContentInstruction(payload.formato),
    ].join('\n');
}

/** Ref seguro para el cuerpo del documento de respaldo: la conversación nunca
    se vuelca en crudo (evita que el PDF salga con el texto de una respuesta
    anterior de FLU, p. ej. "Procederé a generar un video…" — Bug #6). */
function safeFuenteLabel(fuente: { tipo?: string; ref?: string } | undefined, index: number): string {
    if (!fuente) return '';
    const tipo = String(fuente.tipo || '').toLowerCase();
    const ref = String(fuente.ref || '').trim();
    if (tipo === 'conversacion') {
        // La conversación se cita como referencia genérica, nunca su texto.
        return `Conversación reciente (${index + 1})`;
    }
    return ref ? `${tipo}: ${ref.slice(0, 160)}` : `${tipo} (${index + 1})`;
}

/** Contenido de respaldo cuando no hay LLM disponible (degradación elegante). */
export function buildGenerationFallbackContent(payload: GenerationInput, language = 'es'): string {
    const langInstr = language === 'en'
        ? 'Generated without AI (offline fallback).'
        : 'Generado sin IA (respaldo sin conexión).';
    const tema = payload.parametros?.tema || 'Documento';
    if (payload.formato === 'xlsx') {
        return JSON.stringify({
            sheets: [
                {
                    name: 'Contenido',
                    rows: [
                        ['Sección', 'Detalle'],
                        ['Tema', tema],
                        ['Fuente', 'Conversación reciente'],
                        ['Estado', langInstr],
                    ],
                },
            ],
            notas: langInstr,
        });
    }
    if (payload.formato === 'csv') {
        return `Sección;Detalle\nTema;${tema}\nEstado;${langInstr}`;
    }
    if (payload.formato === 'json') {
        return JSON.stringify({
            tema,
            formato: payload.formato,
            fuentes: (payload.fuentes || []).map((f, i) => safeFuenteLabel(f, i)),
            nota: langInstr,
        });
    }
    if (payload.formato === 'ics') {
        const now = new Date();
        const stamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        return [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//FLU//ES//EN',
            'BEGIN:VEVENT',
            `UID:flu-${Date.now()}@flu`,
            `DTSTAMP:${stamp}`,
            `SUMMARY:${tema}`,
            'DESCRIPTION:' + langInstr,
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\r\n');
    }
    if (payload.formato === 'pptx') {
        return [
            `# ${tema}`,
            `- ${langInstr}`,
            `## Contexto`,
            `- Documento generado por FLU sin conexión a IA sobre el tema "${tema}".`,
            `## Fuentes`,
            ...(payload.fuentes || []).map((f, i) => `- ${safeFuenteLabel(f, i)}`),
            `## Siguientes pasos`,
            `- Proporciona una clave de API para generar contenido completo.`,
        ].join('\n');
    }
    if (payload.formato === 'video') {
        return [
            `# ${tema}`,
            ``,
            `## Escena 1 — Introducción`,
            `Hoy te contamos sobre "${tema}".`,
            ``,
            `## Escena 2 — Explicación`,
            `Repasamos los puntos principales del tema "${tema}" de forma sencilla.`,
            ``,
            `## Escena 3 — Cierre`,
            `Recuerda: pregunta a FLU para profundizar en "${tema}".`,
        ].join('\n');
    }
    const fuentes = (payload.fuentes || []).map((f, i) => safeFuenteLabel(f, i));
    return [
        `# ${tema}`,
        ``,
        `> ${langInstr}`,
        ``,
        `## Introducción`,
        `Este documento de FLU aborda el tema "${tema}".`,
        ``,
        `## Desarrollo`,
        `Respaldo sin conexión: se incluye el encuadre del tema; para un desarrollo completo conecta una clave de API de IA.`,
        ``,
        `## Fuentes consultadas`,
        ...(fuentes.length ? fuentes : ['Ninguna fuente explícita']),
        ``,
        `## Estado`,
        `Proporciona una clave de API para generar contenido completo enriquecido.`,
    ].join('\n');
}
