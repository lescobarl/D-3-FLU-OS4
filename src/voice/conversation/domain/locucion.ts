/**
 * DOMINIO DE LA LOCUCIÓN — módulo CONVERSACIÓN (nuevo).
 *
 * Puro: no importa NADA. No conoce `lib`, ni el store, ni el ASR, ni la UI. Sólo el
 * estado de una locución y las reglas que la hacen fila.
 *
 * Reglas que este archivo hace imposibles:
 *  R1  Una locución = un tramo = una fila. Sin tramo no hay fila.
 *  R2  Una sola puerta de commit: sólo se commitea una locución CERRADA.
 *  R3  Tramo inválido (`fin <= inicio`) se CUENTA, no se silencia.
 *  R4  Etiqueta nunca `?`: identidad confirmada, `Hablante N`, continuidad o semilla.
 *  R5  La caja ES el texto de la locución abierta; no se escribe desde fuera.
 *  R6  Una reemisión del mismo tramo no pierde palabras; una corrección explícita sí
 *      puede reemplazar, pero se declara como corrección.
 */

export type Tramo = { inicio: number; fin: number }

export type EvidenciaEtiqueta = 'nombre' | 'medida' | 'continuidad' | 'semilla'

export type Fila = {
  sessionId: string
  texto: string
  tramo: Tramo
  etiqueta: string
  evidencia: EvidenciaEtiqueta
  provisional: boolean
  turnId: string
}

export type Locucion = {
  id: string
  turnId: string
  inicio: number
  fin: number | null
  texto: string
  cerrada: boolean
  motivoCierre: string | null
  tramoInvalido: boolean
  etiqueta: string | null
  evidencia: EvidenciaEtiqueta | null
}

export type Estado = {
  sessionId: string
  semilla: string
  ultimaEtiqueta: string | null
  locucion: Locucion | null
  filas: Fila[]
  descartes: string[]
  tramosInvalidos: number
  secuencia: number
}

export type ModoRevision = 'union' | 'correccion'

/**
 * Une dos versiones del MISMO tramo.
 * - `union`: una reemisión no pierde palabras. Si una contiene a la otra, gana la
 *   larga; si comparten prefijo, se conservan ambas colas. Sin prefijo común se
 *   considera otra emisión y gana la nueva (el llamador debió separar el tramo).
 * - `correccion`: el ASR corrigió el mismo tramo y gana la nueva versión, incluso
 *   si reemplaza palabras. Es una decisión explícita, no una pérdida silenciosa.
 */
export function unirRevision(anterior: string, nuevo: string, modo: ModoRevision = 'union'): string {
  const a = String(anterior || '').trim()
  const b = String(nuevo || '').trim()
  if (!a) return b
  if (!b) return a
  if (b.includes(a)) return b
  if (a.includes(b)) return a

  const pa = String(a).trim().split(/\s+/).filter(Boolean)
  const pb = String(b).trim().split(/\s+/).filter(Boolean)
  let comun = 0
  while (comun < pa.length && comun < pb.length && pa[comun].toLowerCase() === pb[comun].toLowerCase()) {
    comun += 1
  }

  if (modo === 'correccion') return b
  if (comun === 0) return b
  return [...pa.slice(0, comun), ...pa.slice(comun), ...pb.slice(comun)].join(' ')
}

export function crearEstado({ sessionId = 'sesion', semilla }: { sessionId?: string; semilla: string }): Estado {
  return {
    sessionId,
    semilla,
    ultimaEtiqueta: null,
    locucion: null,
    filas: [],
    descartes: [],
    tramosInvalidos: 0,
    secuencia: 0,
  }
}

/**
 * Abre una locución en la muestra `inicio`. Falla si ya hay una abierta:
 * dos locuciones abiertas a la vez es un defecto del llamador, no un caso.
 */
export function abrir(estado: Estado, { inicio, turnId = '' }: { inicio: number; turnId?: string }): Estado {
  if (estado.locucion) throw new Error(`locucion ya abierta: ${estado.locucion.id}`)
  const arranque = Number(inicio)
  if (!Number.isFinite(arranque) || arranque < 0) throw new Error(`inicio invalido: ${inicio}`)
  const secuencia = estado.secuencia + 1
  return {
    ...estado,
    secuencia,
    locucion: {
      id: `${estado.sessionId}:${secuencia}`,
      turnId: String(turnId || ''),
      inicio: arranque,
      fin: null,
      texto: '',
      cerrada: false,
      motivoCierre: null,
      tramoInvalido: false,
      etiqueta: null,
      evidencia: null,
    },
  }
}

/**
 * Aplica el texto del ASR a la locución abierta.
 * `modo: 'union'` para reemisión; `modo: 'correccion'` para una corrección explícita.
 */
export function ponerTexto(
  estado: Estado,
  { texto, modo = 'union' }: { texto: string; modo?: ModoRevision } = { texto: '' },
): Estado {
  const abierta = estado.locucion
  if (!abierta) throw new Error('ponerTexto sin locucion abierta')
  const nuevo = unirRevision(abierta.texto, texto, modo)
  return { ...estado, locucion: { ...abierta, texto: nuevo } }
}

/**
 * Cierra por audio: fija `fin` y marca inválido el tramo que no avanza (R3).
 */
export function cerrar(estado: Estado, { fin, motivo = 'audio' }: { fin: number; motivo?: string } = { fin: 0 }): Estado {
  const abierta = estado.locucion
  if (!abierta) throw new Error('cerrar sin locucion abierta')
  const final = Number(fin)
  const invalido = !Number.isFinite(final) || final <= abierta.inicio
  return {
    ...estado,
    tramosInvalidos: estado.tramosInvalidos + (invalido ? 1 : 0),
    locucion: {
      ...abierta,
      fin: invalido ? null : final,
      cerrada: true,
      motivoCierre: String(motivo || 'audio'),
      tramoInvalido: invalido,
    },
  }
}

/**
 * Etiqueta de la locución abierta. Sin `?`, nunca (R4).
 * Prioridad: nombre CONFIRMADO → voz medida (`Hablante N`) → continuidad → semilla.
 * Un `nombre` sin `nombreConfirmado` se ignora: la etiqueta no se afirma sin evidencia.
 */
export function etiquetar(
  estado: Estado,
  {
    nombre = '',
    nombreConfirmado = false,
    hablante = '',
    continuidad = false,
  }: { nombre?: string; nombreConfirmado?: boolean; hablante?: string; continuidad?: boolean } = {},
): Estado {
  const abierta = estado.locucion
  if (!abierta) throw new Error('etiquetar sin locucion abierta')

  let etiqueta = ''
  let evidencia: EvidenciaEtiqueta = 'semilla'

  if (nombre && nombreConfirmado) {
    etiqueta = String(nombre).trim()
    evidencia = 'nombre'
  } else if (hablante) {
    etiqueta = String(hablante).trim()
    evidencia = 'medida'
  } else if (continuidad && estado.ultimaEtiqueta) {
    etiqueta = estado.ultimaEtiqueta
    evidencia = 'continuidad'
  }

  if (!etiqueta) {
    etiqueta = estado.semilla
    evidencia = 'semilla'
  }
  if (etiqueta === '?') throw new Error('etiqueta ? prohibida')
  return {
    ...estado,
    ultimaEtiqueta: etiqueta,
    locucion: { ...abierta, etiqueta, evidencia },
  }
}

/**
 * PUERTA ÚNICA de commit (R2,R3,R5): exige locución cerrada; sin tramo válido o sin
 * texto no inventa fila: lo registra como descarte. Devuelve el estado sin locución.
 */
export function commit(estado: Estado): { estado: Estado; fila: Fila | null; descarte: string | null } {
  const cerrada = estado.locucion
  if (!cerrada) throw new Error('commit sin locucion')
  if (!cerrada.cerrada) throw new Error(`commit de locucion abierta: ${cerrada.id}`)

  const sinFila = (motivo: string) => ({
    estado: { ...estado, locucion: null, descartes: [...estado.descartes, `${cerrada.id}:${motivo}`] },
    fila: null,
    descarte: motivo,
  })

  if (cerrada.tramoInvalido) return sinFila('tramoInvalido')
  if (!String(cerrada.texto || '').trim()) return sinFila('sinTexto')

  const fila: Fila = {
    sessionId: estado.sessionId,
    texto: cerrada.texto,
    tramo: { inicio: cerrada.inicio, fin: cerrada.fin as number },
    etiqueta: cerrada.etiqueta ?? estado.semilla,
    evidencia: cerrada.evidencia ?? 'semilla',
    provisional: cerrada.motivoCierre !== 'audio',
    turnId: cerrada.turnId,
  }
  return { estado: { ...estado, locucion: null, filas: [...estado.filas, fila] }, fila, descarte: null }
}

/**
 * La caja es el texto de la locución abierta (R5). Cerrada o sin locución: vacía.
 */
export function caja(estado: Estado): { texto: string; abierta: boolean } {
  const abierta = estado.locucion
  if (!abierta || abierta.cerrada) return { texto: '', abierta: false }
  return { texto: abierta.texto, abierta: true }
}
