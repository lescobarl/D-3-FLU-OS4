// ============================================================
// generatedInsumo — Texto de INSUMO de un artefacto GENERADO por FLU
// ------------------------------------------------------------
// Hermano de documentInsumo (documentos subidos) e imageInsumo (imagen subida).
// Fuente UNICA del texto que entra al historial de conversacion cuando FLU
// GENERA un artefacto (carta/documento, guion de video): asi los turnos
// siguientes (y la minuta) usan su contenido, simetrico a lo CARGADO.
//
// MOTIVO (hueco medido 2026-10-06, P8.82): el cuerpo generado se guardaba en el
// historial de DOCUMENTOS (documents) pero NO entraba al historial de
// conversacion, asi que FLU no podia explicar ni referir una carta o un guion
// que el mismo acababa de producir.
// ============================================================
import { pickText } from '../../lib/uiStrings';

/** Forma minima del resultado de generacion que aporta el insumo. */
export interface GeneratedInsumoSource {
    /** Cuerpo textual legible (el que produce el LLM), independiente del binario. */
    text?: string;
    /** Titulo/nombre legible del artefacto. */
    nombre?: string;
}

/**
 * Texto de insumo de un artefacto generado, o null si NO trae cuerpo textual.
 * NO inventa contenido: sin cuerpo legible no hay insumo (p. ej. un binario sin
 * `text`). El titulo, si lo hay, se antepone como contexto.
 */
export function buildGeneratedInsumo(
    result: GeneratedInsumoSource | null | undefined,
    language = 'es',
): string | null {
    if (!result) return null;
    const cuerpo = String(result.text || '').trim();
    if (!cuerpo) return null;
    const titulo = String(result.nombre || '').trim();
    const ctx = titulo ? `${titulo}: ${cuerpo}` : cuerpo;
    return pickText(language, 'contexto_de_documento_generado_por_flu', { ctx });
}
