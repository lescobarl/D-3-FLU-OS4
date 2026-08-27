// ============================================================
// documentChunker.ts — map-reduce del análisis de documentos (F1)
// ============================================================
// Orquestación del pipeline: los chunks extraídos por
// documentParser se procesan en dos fases puras y testeables:
//   map    → buildMapPrompt: prompt por chunk (lectura parcial)
//   reduce → buildReducePrompt + mergePartialSummaries: fusión
//            de las lecturas parciales en resumen/puntos_clave.
//
// El LLM produce el contenido; este módulo solo construye los
// mensajes y fusiona respuestas (Rule #1: NO HARDCODE → límites
// desde fluConfig.limits.documentAnalysis).
// ============================================================

import type { DocumentSheetInfo, DocumentTipo, DocumentContract } from '../types/documentContracts';
import { FLU_CONFIG } from '../voice/lib/fluConfig';

export interface ChunkContext {
  tipo: DocumentTipo;
  nombre: string;
  hojas?: DocumentSheetInfo[];
  errores: string[];
}

/** Resultado parcial de la fase map (lo que devuelve el LLM por chunk). */
export interface PartialSummary {
  resumen: string;
  puntos_clave: string[];
}

function getMaxChunks(): number {
  return ((FLU_CONFIG.limits as Record<string, unknown>).documentAnalysis as { maxChunks?: number } | undefined)
    ?.maxChunks ?? 48;
}

function buildContextBlock(ctx: ChunkContext): string {
  const lines = [
    `Tipo de documento: ${ctx.tipo}`,
    `Nombre del archivo: ${ctx.nombre}`,
  ];
  if (ctx.hojas && ctx.hojas.length) {
    lines.push(
      `Estructura: ${ctx.hojas
        .map((h) => `"${h.nombre}" (${h.rol}, ${h.celdas} celdas)`)
        .join(', ')}`
    );
  }
  if (ctx.errores && ctx.errores.length) {
    lines.push(`Errores de fórmula detectados: ${ctx.errores.slice(0, 10).join('; ')}`);
  }
  return lines.join('\n');
}

/** Prompt de la fase map: lee UN chunk y extrae resumen + puntos clave. */
export function buildMapPrompt(
  chunk: string,
  index: number,
  total: number,
  ctx: ChunkContext,
  language = 'es'
): string {
  const langInstr =
    language === 'en'
      ? 'Respond in English only.'
      : 'Responde únicamente en español.';
  return [
    `Eres un analista de documentos. Contexto del documento:`,
    buildContextBlock(ctx),
    ``,
    `Fragmento ${index}/${total} del texto extraído:`,
    `"""`,
    chunk,
    `"""`,
    ``,
    `Extrae SOLO de este fragmento: 1) un resumen breve (2-4 líneas) de lo que contiene, y 2) hasta 5 puntos clave con valor informativo. ${langInstr}`,
    `Devuelve JSON válido con el formato: {"resumen": string, "puntos_clave": string[]}. No inventes datos que no estén en el fragmento.`,
  ].join('\n');
}

/** Prompt de la fase reduce: fusiona las lecturas parciales en el contrato final. */
export function buildReducePrompt(
  partials: Array<PartialSummary & { indice: number }>,
  ctx: ChunkContext,
  language = 'es'
): string {
  const langInstr =
    language === 'en'
      ? 'Respond in English only.'
      : 'Responde únicamente en español.';
  const serialized = partials
    .map((p) => `--- Fragmento ${p.indice} ---\nResumen: ${p.resumen}\nPuntos: ${p.puntos_clave.join(' | ')}`)
    .join('\n\n');
  return [
    `Eres un analista de documentos. Recibiste lecturas parciales de un mismo documento:`,
    buildContextBlock(ctx),
    ``,
    serialized,
    ``,
    `Genera el análisis final consolidado del documento completo. ${langInstr}`,
    `Devuelve JSON válido con el formato:`,
    `{"resumen": string (5-10 líneas, ejecutivo), "puntos_clave": string[] (5-10, no repetidos), "escenarios": [{"nombre": string, "descripcion": string}] (opcional, máx 3 si aplica)}.`,
    `No inventes datos que no aparezcan en las lecturas parciales.`,
  ].join('\n');
}

/** Prompt para análisis de documento corto: UNA sola llamada (sin map-reduce). */
export function buildSingleAnalysisPrompt(
  text: string,
  ctx: ChunkContext,
  language = 'es'
): string {
  const langInstr =
    language === 'en'
      ? 'Respond in English only.'
      : 'Responde únicamente en español.';
  return [
    `Eres un analista de documentos. Contexto del documento:`,
    buildContextBlock(ctx),
    ``,
    `Texto extraído completo del documento:`,
    `"""`,
    text,
    `"""`,
    ``,
    `Genera el análisis final del documento. ${langInstr}`,
    `Devuelve JSON válido con el formato:`,
    `{"resumen": string (5-10 líneas, ejecutivo), "puntos_clave": string[] (5-10), "escenarios": [{"nombre": string, "descripcion": string}] (opcional, máx 3 si aplica)}.`,
    `No inventes datos que no aparezcan en el texto.`,
  ].join('\n');
}

/**
 * Fusión heurística de lecturas parciales (fase reduce SIN LLM).
 * Usada como respaldo si el LLM no está disponible y para tests.
 * Devuelve resumen/puntos_clave/escenarios consolidados.
 */
export function mergePartialSummaries(
  partials: Array<PartialSummary & { indice: number }>,
  maxPoints = 10
): { resumen: string; puntos_clave: string[]; escenarios: Record<string, unknown>[] } {
  const resumen = partials
    .map((p) => p.resumen.trim())
    .filter(Boolean)
    .join(' ');
  const vistos = new Set<string>();
  const puntos_clave: string[] = [];
  for (const p of partials) {
    for (const punto of p.puntos_clave || []) {
      const key = punto.trim().toLowerCase();
      if (!key || vistos.has(key)) continue;
      vistos.add(key);
      puntos_clave.push(punto.trim());
      if (puntos_clave.length >= maxPoints) break;
    }
    if (puntos_clave.length >= maxPoints) break;
  }
  return { resumen, puntos_clave, escenarios: [] };
}

/** Aplica el resultado de la fase reduce al contrato base del parser. */
export function applyReduceToContract(
  contract: DocumentContract,
  reduced: { resumen: string; puntos_clave: string[]; escenarios?: Record<string, unknown>[] }
): DocumentContract {
  return {
    ...contract,
    resumen: reduced.resumen || contract.resumen,
    puntos_clave: reduced.puntos_clave?.length ? reduced.puntos_clave : contract.puntos_clave,
    escenarios: reduced.escenarios || contract.escenarios,
  };
}

/** Re-export del tope de chunks para el servicio (evita duplicar el literal). */
export function getDocumentAnalysisLimits(): { maxChunks: number } {
  return { maxChunks: getMaxChunks() };
}
