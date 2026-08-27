/**
 * Resolución del proveedor STT streaming — función pura sin dependencias.
 * Aislada de streamSttHandler.mjs (que depende de 'ws') para poder
 * validarse en aislamiento y mantener el contrato documentado:
 *   FLU_STT_PROVIDER=mock|deepgram
 *
 * - 'deepgram' solo es seleccionable si DEEPGRAM_API_KEY está presente.
 * - Cualquier otro valor (o ausencia) → 'mock' (modo 100% local).
 */
export function resolveStreamSttProviderName(env = process.env) {
  const provider = String(env?.FLU_STT_PROVIDER || '').trim().toLowerCase()
  if (provider === 'deepgram' && String(env?.DEEPGRAM_API_KEY || '').trim()) {
    return 'deepgram'
  }
  return 'mock'
}
