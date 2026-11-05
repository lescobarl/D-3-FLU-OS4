/**
 * Ratchet de nombres de función, compartido por los guards de rutas dobles.
 *
 * La fuente es el texto del archivo: se quitan comentarios antes de medir para
 * que un comentario que nombra una función no la declare. Se cuentan las formas
 * reales de declarar — `function`, const-arrow y const-function — más los
 * métodos de objeto/clase, que son funciones con nombre aunque no lleven
 * `function`.
 */

/**
 * Nombres de función declarados en un fuente.
 * @param {string} src Texto del archivo.
 * @returns {string[]} Nombres ordenados.
 */
export function nombresDeFunciones(src) {
  const limpio = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const nombres = new Set()
  for (const match of limpio.matchAll(
    /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]/g,
  )) {
    nombres.add(match[1])
  }
  for (const match of limpio.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
  )) {
    nombres.add(match[1])
  }
  // Expresión de función con nombre implícito (`const ruta = function () {}`):
  // es una forma real de declarar y no puede quedar fuera del ratchet.
  for (const match of limpio.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?function\b/g,
  )) {
    nombres.add(match[1])
  }
  for (const match of limpio.matchAll(
    /^[ \t]*(?:(?:public|private|protected|static|async|get|set|readonly|override)[ \t]+)*#?([A-Za-z_$][\w$]*)[ \t]*\([^)]*\)[ \t]*(?::[^{\n]+)?\{/gm,
  )) {
    if (!/^(?:if|for|while|switch|catch|function|constructor|return|typeof|await)$/.test(match[1])) {
      nombres.add(match[1])
    }
  }
  return [...nombres].sort()
}

/**
 * Funciones presentes que no están en la línea base (el ratchet solo sube).
 * @param {readonly {nombre: string, src: string}[]} fuentes Fuentes a medir.
 * @param {Record<string, readonly string[]>} base Nombres declarados por archivo.
 * @returns {string[]} Entradas `archivo:nombre` no declaradas.
 */
export function funcionesNuevas(fuentes, base) {
  return fuentes.flatMap((archivo) => {
    const conocidas = new Set(base[archivo.nombre] ?? [])
    return nombresDeFunciones(archivo.src)
      .filter((nombre) => !conocidas.has(nombre))
      .map((nombre) => `${archivo.nombre}:${nombre}`)
  })
}
