/**
 * SUPERFICIE PASIVA del módulo CONVERSACIÓN (modo wake sin conversación activa).
 *
 * Mandato 2026-10-30 (problema 6): UNA sola ruta de la fila del usuario. El
 * escritor pasivo (`commitUserTurnRow` + `crearEscritorFilaUsuario`) era un
 * SEGUNDO dueño de esa decisión y quedó RETIRADO: la fila la escribe SOLO el
 * módulo (`row.committed`, puerta de abajo: silencio, cambio de voz o cierre),
 * en AMBOS modos.
 *
 * El RESOLUTOR pasivo (`crearResolucionPasiva`) también quedó RETIRADO: el hook
 * ya no mide la voz por su cuenta; la mide el módulo al cerrar y la publica en
 * `row.committed`. Aquí solo sobrevive el RENOMBRE de UNA fila concreta por su
 * id (migración de la fachada, consumidor vivo: `useParticipants`).
 *
 * Puro: sin `Date.now()` (reloj inyectado), sin acceso al store ni a los dueños
 * vivos del proyecto (llegan por puertos).
 */
import type { PuertoVistaFilas, UtilidadesFila } from './ports.ts'

/** Dependencias del renombre de una fila concreta de la vista. */
export type DependenciasRenombreFila = Readonly<{
  vista: Pick<PuertoVistaFilas, 'leerHistorial' | 'fijarNombre'>
  utilidades: Pick<UtilidadesFila, 'canonica'>
}>

/**
 * Corrige el nombre de UNA fila concreta de usuario por su id (migración de la
 * fachada). No escribe filas: es la ÚNICA corrección de rótulo que sobrevive al
 * escritor retirado.
 * @param rowId Id de la fila en la vista.
 * @param speakerName Nombre que se fija (se canoniza con el dueño único).
 * @param deps Vista y utilidades delegadas.
 * @returns `true` si la fila existe, es de usuario y el nombre se fijó.
 */
export function renombrarFilaDeUsuario(
  rowId: string,
  speakerName: string,
  deps: DependenciasRenombreFila,
): boolean {
  const idFila = String(rowId || '')
  const nombre = deps.utilidades.canonica(String(speakerName || '').trim())
  if (!idFila || !nombre) return false
  const entry = deps.vista.leerHistorial().find((e) => e.id === idFila)
  if (!entry || entry.role !== 'user') return false
  deps.vista.fijarNombre(idFila, nombre)
  return true
}
