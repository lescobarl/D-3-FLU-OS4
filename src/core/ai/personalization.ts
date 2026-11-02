/**
 * Personalización de IA — dueño ÚNICO de la traducción de los ajustes de
 * personalidad (`traits`, `tone`, `explanationLevel`) a las dos formas que
 * consumen los motores: payload estructurado (Gemini/proxy) y regla de texto
 * (motor OpenAI-compatible). Ningún adapter vuelve a leer esos ajustes.
 */
import type { AIRequestOptions } from './IAIService'

/** Personalidad canónica de una petición. */
export interface PersonalityPayload {
  traits: string[]
  tone: string
  explanationLevel: string
  name: string
  profile: string
}

/**
 * Resuelve la personalidad de una petición.
 * @param options Opciones de la petición de IA.
 * @returns Payload canónico, o `null` si no hay ajustes activos.
 */
export function buildPersonalityPayload(options: AIRequestOptions): PersonalityPayload | null {
  if (!(options.traits || options.tone || options.explanationLevel)) return null
  return {
    traits: options.traits || [],
    tone: options.tone || '',
    explanationLevel: options.explanationLevel || '',
    name: '',
    profile: options.role || '',
  }
}

/**
 * Regla de personalización para el system prompt del motor de texto.
 * @param options Opciones de la petición de IA.
 * @param isEnglish Idioma de la regla.
 * @returns Regla precedida de salto de línea, o cadena vacía.
 */
export function buildPersonalizationRule(options: AIRequestOptions, isEnglish: boolean): string {
  const payload = buildPersonalityPayload(options)
  if (!payload) return ''
  const parts: string[] = []
  if (payload.traits.length > 0) {
    parts.push(
      isEnglish
        ? `Your personality traits are: ${payload.traits.join(', ')}.`
        : `Tus rasgos de personalidad son: ${payload.traits.join(', ')}.`,
    )
  }
  if (payload.tone) {
    parts.push(
      isEnglish
        ? `Your communication tone is: ${payload.tone}.`
        : `Tu tono de comunicacion es: ${payload.tone}.`,
    )
  }
  if (payload.explanationLevel) {
    parts.push(
      isEnglish
        ? `Explanation level: ${payload.explanationLevel}. Adjust the depth of your answers to match this level (simple = short and plain, detallado = thorough with steps and examples, avanzado = technical and advanced).`
        : `Nivel de explicacion: ${payload.explanationLevel}. Ajusta la profundidad de tus respuestas a ese nivel (simple = breve y claro, detallado = a fondo con pasos y ejemplos, avanzado = tecnico).`,
    )
  }
  return parts.length > 0 ? `\n\n${parts.join(' ')}` : ''
}
