// ============================================================
// imageInsumo — Texto de INSUMO del analisis de una IMAGEN subida
// ------------------------------------------------------------
// Hermano de documentInsumo (documentos). Fuente UNICA del texto que entra al
// historial de conversacion cuando el usuario sube una imagen: asi las
// respuestas siguientes (y la minuta) usan su contenido.
//
// MOTIVO (hueco medido 2026-10-06): para una imagen, App.tsx metia al historial
// SOLO `texto_extraido` y bajo `if (result.texto_extraido)`. Un DIBUJO (foto sin
// texto legible) no generaba NINGUN contexto -> FLU no podia continuar su
// explicacion (p. ej. tutoria en ingles sobre un dibujo). El analisis
// multimodal YA trae materia, problemas, instrucciones y nivel: TODO eso
// compone el insumo.
// ============================================================
import type { AIVisionAnalysisResult } from '../ai/aiServiceBase';
import { pickText } from '../../lib/uiStrings';

/** Compone los campos del analisis en un texto legible (una sola fuente). */
function composeAnalysisText(result: AIVisionAnalysisResult): string {
    const problemas = Array.isArray(result.problemas) ? result.problemas.join(', ') : '';
    return [result.materia, result.nivel, result.instrucciones, problemas, result.texto_extraido]
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .join('. ');
}

/**
 * Texto de insumo del analisis de imagen, o null si el analisis no trae NADA.
 * NO exige `texto_extraido`: un dibujo tambien aporta contexto (materia,
 * instrucciones, nivel).
 */
export function buildImageInsumo(
    result: AIVisionAnalysisResult | null | undefined,
    language = 'es',
): string | null {
    if (!result) return null;
    const ctx = composeAnalysisText(result);
    if (!ctx) return null;
    return pickText(language, 'contexto_de_imagen_subida_por_el_usua', { ctx });
}
