// ============================================================
// documentInsumo — Texto de INSUMO de un documento analizado
// ------------------------------------------------------------
// Fuente única del texto que entra al historial de conversación cuando el
// usuario sube un documento: así las respuestas siguientes usan su contenido.
// Prefiere qa_context (contexto para el LLM) y cae a resumen.
// ============================================================
import type { DocumentContract } from '../../types/documentContracts';

import { pickText } from '../../lib/uiStrings';
export function buildDocumentInsumo(
  contract: DocumentContract | null | undefined,
  language = 'es',
): string | null {
  if (!contract) return null;
  const ctx = String(contract.qa_context || contract.resumen || '').trim();
  if (!ctx) return null;
  return pickText(language, 'contexto_de_documento_subido_por_el_usua_2', { ctx });
}
