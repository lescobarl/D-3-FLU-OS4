/**
 * ESTADO DE LA LOCUCIÓN — dueño único de las DOS preguntas que antes se mezclaban.
 *
 * El defecto medido: el ingress decidía «¿sigo en la misma locución?» con un `||` de dos
 * criterios que responden a cosas distintas (`utterancesRelate` y `utterancesSameRevision`),
 * así que una revisión del ASR y una extensión del dictado se trataban como lo mismo. Aquí
 * cada pregunta tiene su respuesta y su dueño, sin un predicado nuevo:
 *
 *  - `mismaRevision`: el ASR reemitió el MISMO audio con otro texto (`utterancesSameRevision`).
 *  - `crecimiento`: el texto nuevo CONTIENE al anterior (`utterancesRelate`).
 *  - `locucionNueva`: ni lo uno ni lo otro → el texto abre otra locución.
 *
 * No decide el commit: informa. Quien escribe la fila consulta el estado.
 */
import { utterancesSameRevision } from '../lib/conversationStream.js'
import { utterancesRelate } from '../lib/speechMerge.js'

/**
 * @param {string} anterior texto ya conocido (pendiente, última fila o lo mostrado)
 * @param {string} nuevo texto que llega
 * @returns {{ mismaRevision: boolean, crecimiento: boolean, locucionNueva: boolean }}
 */
export function estadoDeLocucion(anterior = '', nuevo = '') {
  const previo = String(anterior || '').trim()
  const texto = String(nuevo || '').trim()
  if (!previo || !texto) return { mismaRevision: false, crecimiento: false, locucionNueva: false }
  const mismaRevision = utterancesSameRevision(previo, texto)
  const crecimiento = utterancesRelate(previo, texto)
  return { mismaRevision, crecimiento, locucionNueva: !mismaRevision && !crecimiento }
}
