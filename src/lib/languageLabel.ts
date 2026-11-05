/**
 * languageLabel — etiqueta visible de un código de idioma, dueño único.
 *
 * El diccionario aporta la cadena (`lang_xx`); el fallback lo decide cada
 * consumidor. Antes cada panel resolvía su propia cadena de respaldo.
 */

/**
 * Resuelve la etiqueta de un idioma.
 * @param labels Diccionario de etiquetas del catálogo.
 * @param lang Código de idioma.
 * @param fallback Cadena si no hay etiqueta (por defecto, el propio código).
 * @returns Etiqueta visible.
 */
export function languageLabel(
  labels: Record<string, string>,
  lang: string,
  fallback?: string,
): string {
  return labels[`lang_${lang}`] || fallback || lang
}
