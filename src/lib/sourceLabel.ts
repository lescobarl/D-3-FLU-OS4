/**
 * sourceLabel — etiqueta visible de una fuente de resultados, dueño único.
 *
 * El diccionario source→etiqueta lo aporta cada consumidor (sus textos de UI);
 * la resolución y su fallback viven aquí.
 */

/**
 * Resuelve la etiqueta de una fuente.
 * @param source Id de la fuente.
 * @param labels Diccionario source→etiqueta.
 * @returns Etiqueta del diccionario, el propio id, o cadena vacía.
 */
export function sourceLabelFor(
  source: string | undefined,
  labels: Readonly<Record<string, string>>,
): string {
  if (!source) return ''
  return labels[source] || source
}
