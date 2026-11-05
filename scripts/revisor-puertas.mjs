/**
 * Puertas del revisor de funciones.
 *
 * Lógica compartida por el hook PreToolUse, el hook commit-msg y el paso de CI.
 * Un cambio que añade una función bajo `src/` se evalúa contra el índice real:
 * si se parece a una existente, se bloquea salvo que la función declare su
 * veredicto en el JSDoc:
 *
 *   @revisor CREAR NUEVO — <justificación>
 *
 * o, en un commit, traiga los trailers:
 *
 *   Revisor-Funciones: CREAR NUEVO
 *   Revisor-Motivo: <justificación>
 *
 * REUSAR no vale para una función nueva: si el veredicto es reusar, no se crea.
 *
 * LÍMITE: la declaración la escribe el agente. La puerta obliga a mirar y deja
 * rastro en el código o en el commit; no demuestra equivalencia semántica.
 */
import { buscarCandidatos } from './revisor-funciones.mjs'

export const UMBRAL_FUNCION = 0.7
export const UMBRAL_CASO = 0.5
export const MIN_MOTIVO = 8

/**
 * Funciones que aparecen en el estado nuevo y no existían por nombre completo
 * en el estado viejo.
 * @param {object[]} viejas Funciones del estado anterior.
 * @param {object[]} nuevas Funciones del estado nuevo.
 * @returns {object[]} Funciones agregadas.
 */
export function funcionesAgregadas(viejas, nuevas) {
  const previas = new Set(viejas.map((funcion) => funcion.nombreCompleto))
  return nuevas.filter((funcion) => !previas.has(funcion.nombreCompleto))
}

/**
 * Quita la declaración del revisor del JSDoc antes de usarlo como pregunta.
 * @param {string} jsdoc JSDoc indexado.
 * @returns {string} JSDoc sin la etiqueta.
 */
export function limpiarJsdoc(jsdoc) {
  return String(jsdoc || '')
    .replace(/@revisor\b.*$/i, '')
    .trim()
}

/**
 * Propuesta del revisor para una función indexada.
 * @param {object} funcion Función indexada.
 * @returns {object} Propuesta.
 */
export function propuestaDeFuncion(funcion) {
  return {
    pregunta: limpiarJsdoc(funcion.jsdoc) || funcion.nombre,
    nombre: funcion.nombre,
    firma: { parametros: funcion.params },
    borrador: funcion.cuerpo || '',
  }
}

/**
 * ¿La función nueva declara un veredicto válido? Solo CREAR NUEVO o EXTENDER:
 * REUSAR significa que no debía crearse.
 * @param {string} jsdoc JSDoc de la función.
 * @param {string} [mensaje] Mensaje de commit.
 * @returns {boolean} Declaración válida.
 */
export function veredictoDeclarado(jsdoc, mensaje = '') {
  const etiqueta = String(jsdoc || '').match(/@revisor\s+(CREAR NUEVO|EXTENDER)\b[\s—:-]+([^@]+)/i)
  if (etiqueta && etiqueta[2].trim().length >= MIN_MOTIVO) return true
  const linea = String(mensaje || '').match(/^Revisor-Funciones:\s+(CREAR NUEVO|EXTENDER)\b/im)
  const motivo = String(mensaje || '').match(/^Revisor-Motivo:\s+(.+)$/im)
  return Boolean(linea && motivo && motivo[1].trim().length >= MIN_MOTIVO)
}

/**
 * Evalúa una función nueva contra el índice. La propia función se excluye del
 * universo para que no se encuentre a sí misma cuando ya está en el árbol.
 * @param {object} funcion Función agregada.
 * @param {object[]} funciones Índice de funciones existentes.
 * @param {object[]} casos Casos declarados de ruta doble.
 * @param {string} [mensaje] Mensaje de commit.
 * @returns {object} Evaluación.
 */
export function evaluarFuncion(funcion, funciones, casos, mensaje = '') {
  if (veredictoDeclarado(funcion.jsdoc, mensaje)) {
    return { funcion, bloquea: false, declarada: true, candidatos: [], topFuncion: null, topCaso: null }
  }
  const universo = funciones.filter(
    (candidata) =>
      !(candidata.archivo === funcion.archivo && candidata.nombreCompleto === funcion.nombreCompleto),
  )
  const propuesta = propuestaDeFuncion(funcion)
  const candidatos = buscarCandidatos(propuesta, universo, { casos, limite: 5 })
  const topFuncion = candidatos.find((candidato) => candidato.origen === 'funcion') ?? null
  const topCaso = candidatos.find((candidato) => candidato.origen === 'caso') ?? null
  const bloquea =
    (topFuncion !== null && topFuncion.puntaje >= UMBRAL_FUNCION) ||
    (topCaso !== null && topCaso.puntaje >= UMBRAL_CASO)
  return { funcion, bloquea, declarada: false, candidatos, topFuncion, topCaso }
}

/**
 * Informe de bloqueo para stderr.
 * @param {object[]} evaluaciones Evaluaciones bloqueadas.
 * @param {string} contexto Puerta que bloquea.
 * @returns {string} Informe.
 */
export function formatearBloqueo(evaluaciones, contexto) {
  const lineas = [
    `[revisor-funciones] BLOQUEADO (${contexto}): función(es) nueva(s) que se parecen a código existente.`,
  ]
  for (const evaluacion of evaluaciones) {
    lineas.push(
      '',
      `  ${evaluacion.funcion.archivo}:${evaluacion.funcion.linea} ${evaluacion.funcion.nombreCompleto}`,
    )
    for (const candidato of evaluacion.candidatos) {
      const donde =
        candidato.origen === 'funcion'
          ? `${candidato.archivo}:${candidato.linea} ${candidato.nombreCompleto}`
          : `caso ${candidato.id} -> dueño ${candidato.owner}`
      lineas.push(`    - ${donde} — ${candidato.puntaje}`)
      for (const motivo of candidato.motivos) lineas.push(`      · ${motivo}`)
    }
  }
  lineas.push(
    '',
    'Antes de crearla:',
    '1. Si ya hay dueño, REUSA o EXTIENDE la función existente; no añadas otra.',
    '2. Si de verdad es nueva, corre el revisor:',
    '     node scripts/revisor-funciones.mjs --pregunta "..." --nombre "..." --parametros N --borrador <archivo> --veredicto crear --justificacion "..."',
    '3. Deja la decisión visible en el JSDoc de la función nueva:',
    '     @revisor CREAR NUEVO — <justificación>',
    '   En un commit también valen los trailers:',
    '     Revisor-Funciones: CREAR NUEVO',
    '     Revisor-Motivo: <justificación>',
    '',
    `Umbrales: función existente >= ${UMBRAL_FUNCION}; caso declarado >= ${UMBRAL_CASO}.`,
  )
  return lineas.join('\n')
}
