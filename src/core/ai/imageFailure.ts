import type { AIWorkspaceImageResult } from './IAIService'
import { GENERATION_FAILED_SOURCE } from '../../lib/generationTrace'

/**
 * Resultado de fallo al generar una imagen.
 * Dueño único del payload de error que repetían los adaptadores.
 * @param prompt Prompt original.
 * @param detail Detalle del error.
 * @returns Resultado con traza de error.
 */
export function imageGenerationFailure(
  prompt: string,
  detail: string,
): AIWorkspaceImageResult {
  return {
    image_url: '',
    trace: {
      provider: 'error',
      hasImage: false,
      source: GENERATION_FAILED_SOURCE,
      error: detail || 'unknown',
      prompt,
    },
  }
}
