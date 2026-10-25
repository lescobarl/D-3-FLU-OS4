// @vitest-environment node
/**
 * DOMINIO DE LA LOCUCIÓN (módulo CONVERSACIÓN nuevo) — reglas R1–R6.
 *
 * Mide el dominio puro: una locución = un tramo = una fila, una sola puerta de commit,
 * tramo inválido contado, etiqueta nunca `?`, caja derivada y revisiones que no pierden
 * palabras. No mide tubería ni UI: eso es de las etapas siguientes.
 */
import { describe, expect, it } from 'vitest'
import {
  abrir,
  caja,
  cerrar,
  commit,
  crearEstado,
  etiquetar,
  ponerTexto,
  unirRevision,
} from '../src/voice/conversation/domain/locucion'

/** Semilla de etiqueta: dato del test, no del dominio (el dominio la recibe). */
const estadoNuevo = (extra: { sessionId?: string; semilla?: string } = {}) =>
  crearEstado({ semilla: 'Hablante 1', ...extra })

describe('R1 — una locución = un tramo = una fila', () => {
  it('abrir + texto + cerrar + commit produce UNA fila con su tramo exacto', () => {
    let e = estadoNuevo({ sessionId: 's1' })
    e = abrir(e, { inicio: 48000, turnId: 't1' })
    e = ponerTexto(e, { texto: 'hola, me escuchas' })
    e = cerrar(e, { fin: 96000 })
    e = etiquetar(e, { continuidad: false })
    const { estado, fila } = commit(e)

    expect(fila).toEqual({
      sessionId: 's1',
      texto: 'hola, me escuchas',
      tramo: { inicio: 48000, fin: 96000 },
      etiqueta: 'Hablante 1',
      evidencia: 'semilla',
      provisional: false,
      turnId: 't1',
    })
    expect(estado.filas).toHaveLength(1)
    expect(estado.locucion).toBeNull()
  })

  it('dos locuciones seguidas dan dos filas con tramos disjuntos', () => {
    let e = estadoNuevo()
    e = abrir(e, { inicio: 0 })
    e = ponerTexto(e, { texto: 'primera' })
    e = cerrar(e, { fin: 24000 })
    e = commit(e).estado

    e = abrir(e, { inicio: 24000 })
    e = ponerTexto(e, { texto: 'segunda' })
    e = cerrar(e, { fin: 48000 })
    const { estado } = commit(e)

    expect(estado.filas.map((f) => f.texto)).toEqual(['primera', 'segunda'])
    expect(estado.filas[1].tramo!.inicio).toBe(estado.filas[0].tramo!.fin)
  })

  it('abrir con una locución ya abierta falla (dos abiertas no es un caso)', () => {
    const e = abrir(estadoNuevo(), { inicio: 0 })
    expect(() => abrir(e, { inicio: 10 })).toThrow(/ya abierta/)
  })
})

describe('R2 — una sola puerta de commit', () => {
  it('commit de una locución ABIERTA falla y no escribe fila', () => {
    let e = abrir(estadoNuevo(), { inicio: 0 })
    e = ponerTexto(e, { texto: 'corto' })
    expect(() => commit(e)).toThrow(/abierta/)
  })
})

describe('R3 — tramo inválido se cuenta, no se silencia', () => {
  it('fin <= inicio: sin fila, descarte declarado y contador en 1', () => {
    let e = abrir(estadoNuevo({ sessionId: 's2' }), { inicio: 5000 })
    e = ponerTexto(e, { texto: 'texto que si existe' })
    e = cerrar(e, { fin: 5000 })
    const { estado, fila, descarte } = commit(e)

    expect(fila).toBeNull()
    expect(descarte).toBe('tramoInvalido')
    expect(estado.tramosInvalidos).toBe(1)
    expect(estado.descartes).toEqual(['s2:1:tramoInvalido'])
    expect(estado.filas).toHaveLength(0)
  })

  it('sin texto no inventa fila: descarte sinTexto', () => {
    let e = abrir(estadoNuevo({ sessionId: 's3' }), { inicio: 0 })
    e = cerrar(e, { fin: 24000 })
    const { estado, fila, descarte } = commit(e)

    expect(fila).toBeNull()
    expect(descarte).toBe('sinTexto')
    expect(estado.filas).toHaveLength(0)
  })
})

describe('R4 — la etiqueta nunca es ?', () => {
  it('primera locución sin medida ni continuidad usa la semilla', () => {
    let e = abrir(estadoNuevo({ semilla: 'Hablante 1' }), { inicio: 0 })
    e = etiquetar(e, {})
    expect(e.locucion!.etiqueta).toBe('Hablante 1')
    expect(e.locucion!.evidencia).toBe('semilla')
  })

  it('un nombre SIN confirmación no se afirma: cae a la semilla', () => {
    let e = abrir(estadoNuevo(), { inicio: 0 })
    e = etiquetar(e, { nombre: 'Luis' })
    expect(e.locucion!.etiqueta).toBe('Hablante 1')
    expect(e.locucion!.evidencia).toBe('semilla')
  })

  it('un nombre confirmado sí se afirma', () => {
    let e = abrir(estadoNuevo(), { inicio: 0 })
    e = etiquetar(e, { nombre: 'Luis', nombreConfirmado: true })
    expect(e.locucion!.etiqueta).toBe('Luis')
    expect(e.locucion!.evidencia).toBe('nombre')
  })

  it('continuidad reusa la etiqueta anterior', () => {
    let e = abrir(estadoNuevo(), { inicio: 0 })
    e = etiquetar(e, { nombre: 'Luis', nombreConfirmado: true })
    e = cerrar(e, { fin: 1000 })
    e = commit(e).estado

    e = abrir(e, { inicio: 1000 })
    e = etiquetar(e, { continuidad: true })
    expect(e.locucion!.etiqueta).toBe('Luis')
    expect(e.locucion!.evidencia).toBe('continuidad')
  })

  it('una voz medida sin nombre se numera, no se bautiza', () => {
    let e = abrir(estadoNuevo(), { inicio: 0 })
    e = etiquetar(e, { hablante: 'Hablante 2' })
    expect(e.locucion!.etiqueta).toBe('Hablante 2')
    expect(e.locucion!.evidencia).toBe('medida')
  })

  it('la etiqueta ? se rechaza en el dominio', () => {
    const e = abrir(estadoNuevo(), { inicio: 0 })
    expect(() => etiquetar(e, { nombre: '?', nombreConfirmado: true })).toThrow(/prohibida/)
  })
})

describe('R5 — la caja es el texto de la locución abierta', () => {
  it('mientras habla muestra el texto; al cerrar queda vacía', () => {
    let e = abrir(estadoNuevo(), { inicio: 0 })
    e = ponerTexto(e, { texto: 'vamos a probar' })
    expect(caja(e)).toEqual({ texto: 'vamos a probar', abierta: true })

    e = cerrar(e, { fin: 24000 })
    expect(caja(e)).toEqual({ texto: '', abierta: false })
  })
})

describe('R6 — una revisión no pierde palabras', () => {
  it('la versión larga gana cuando contiene a la corta', () => {
    expect(unirRevision('vamos a probar', 'vamos a probar el modulo')).toBe(
      'vamos a probar el modulo',
    )
    expect(unirRevision('vamos a probar el modulo', 'vamos a probar')).toBe(
      'vamos a probar el modulo',
    )
  })

  it('una reemisión con prefijo común no pierde ninguna cola', () => {
    const union = unirRevision('vamos a probar', 'vamos a revisar')
    expect(union).toContain('probar')
    expect(union).toContain('revisar')
    expect(unirRevision('es algo extrano porque', 'es algo extrano')).toBe('es algo extrano porque')
  })

  it('una corrección EXPLÍCITA puede reemplazar la cola', () => {
    expect(unirRevision('vamos a probar', 'vamos a revisar', 'correccion')).toBe('vamos a revisar')
  })

  it('texto ajeno sin prefijo común reemplaza (otra emisión)', () => {
    expect(unirRevision('hola que tal', 'magistrado luis ya le puso')).toBe('magistrado luis ya le puso')
  })
})
