// @vitest-environment node
/**
 * REGLAS 4 Y 5 — una fila por locución cerrada y etiqueta sin `?`.
 *
 * Cada caso falla si se quita la rama que mide: tramo válido, texto no vacío,
 * prioridad de etiqueta, UUIDv4, provisional/promoción y borrado lógico.
 */
import { describe, expect, it } from 'vitest'
import { crearAlmacenMemoria } from '../src/voice/conversation/adapters'
import {
  construirFila,
  promoverFila,
  resolverEtiqueta,
} from '../src/voice/conversation/fila'
import type {
  CierreLocucion,
  EntradaEtiqueta,
  ResultadoFila,
  VozEtiqueta,
} from '../src/voice/conversation/fila'
import type { Fila } from '../src/voice/conversation/ports'

const LOC = '123e4567-e89b-42d3-a456-426614174000'

const sinVoz = (extra: Partial<VozEtiqueta> = {}): VozEtiqueta => ({
  nombre: '',
  nombreConfirmado: false,
  hablante: '',
  continuidad: false,
  ...extra,
})

const entradaEtiqueta = (
  extra: Partial<Omit<EntradaEtiqueta, 'voz'>> & { voz?: Partial<VozEtiqueta> } = {},
): EntradaEtiqueta => ({
  voz: sinVoz(extra.voz),
  anterior: extra.anterior ?? null,
  semilla: extra.semilla ?? 'Hablante 1',
})

const cierre = (extra: Partial<CierreLocucion> = {}): CierreLocucion => ({
  locutionId: LOC,
  sessionId: 's1',
  turnId: 't1',
  inicio: 0,
  fin: 16000,
  sampleRate: 16000,
  texto: 'hola',
  idioma: 'es',
  overlap: false,
  final: false,
  reason: 'user',
  voz: sinVoz(),
  etiquetaAnterior: null,
  semillaEtiqueta: 'Hablante 1',
  ...extra,
})

const filaPersistida = (texto: string, extra: Partial<Fila> = {}): Fila => ({
  locutionId: LOC,
  sessionId: 's1',
  turnId: 't1',
  texto,
  tramo: { inicio: 0, fin: 16000, sampleRate: 16000 },
  etiqueta: 'Hablante 1',
  evidencia: 'semilla',
  idioma: 'es',
  overlap: false,
  provisional: true,
  reason: 'user',
  revision: 1,
  updated_at: 1000,
  deleted: false,
  ...extra,
})

describe('regla 5 — prioridad de la etiqueta', () => {
  it('el nombre confirmado gana a todo', () => {
    expect(
      resolverEtiqueta(
        entradaEtiqueta({
          voz: { nombre: 'Ana', nombreConfirmado: true, hablante: 'Hablante 2', continuidad: true },
          anterior: 'Luis',
        }),
      ),
    ).toEqual({ etiqueta: 'Ana', evidencia: 'nombre' })
  })

  it('un nombre sin confirmar no se afirma: gana la voz medida', () => {
    expect(
      resolverEtiqueta(
        entradaEtiqueta({
          voz: { nombre: 'Ana', nombreConfirmado: false, hablante: 'Hablante 2' },
          anterior: 'Luis',
        }),
      ),
    ).toEqual({ etiqueta: 'Hablante 2', evidencia: 'medida' })
  })

  it('sin nombre ni medida, la continuidad usa la etiqueta anterior', () => {
    expect(
      resolverEtiqueta(
        entradaEtiqueta({ voz: { continuidad: true }, anterior: 'Luis' }),
      ),
    ).toEqual({ etiqueta: 'Luis', evidencia: 'continuidad' })
  })

  it('sin evidencia de voz, la semilla de configuración', () => {
    expect(resolverEtiqueta(entradaEtiqueta({ semilla: 'Hablante 1' }))).toEqual({
      etiqueta: 'Hablante 1',
      evidencia: 'semilla',
    })
  })

  it('los valores en blanco no cuentan como evidencia', () => {
    expect(
      resolverEtiqueta(
        entradaEtiqueta({
          voz: { nombre: '   ', nombreConfirmado: true, hablante: '  ', continuidad: true },
          anterior: '  ',
          semilla: 'Hablante 1',
        }),
      ),
    ).toEqual({ etiqueta: 'Hablante 1', evidencia: 'semilla' })
  })

  it('la etiqueta ? nunca se persiste', () => {
    expect(() => resolverEtiqueta(entradaEtiqueta({ semilla: '?' }))).toThrow(/\?/)
    expect(() =>
      resolverEtiqueta(
        entradaEtiqueta({ voz: { nombre: '?', nombreConfirmado: true } }),
      ),
    ).toThrow(/\?/)
  })

  it('sin semilla tampoco hay etiqueta vacía', () => {
    expect(() => resolverEtiqueta(entradaEtiqueta({ semilla: '   ' }))).toThrow(/semilla vacia/)
  })
})

describe('regla 4 — tramo válido y texto producen una fila', () => {
  it('construye la fila con la tupla del plan y provisional si no hay final', () => {
    const resultado: ResultadoFila = construirFila(cierre())
    expect(resultado).toEqual({
      fila: {
        locutionId: LOC,
        sessionId: 's1',
        turnId: 't1',
        texto: 'hola',
        tramo: { inicio: 0, fin: 16000, sampleRate: 16000 },
        etiqueta: 'Hablante 1',
        evidencia: 'semilla',
        idioma: 'es',
        overlap: false,
        provisional: true,
        reason: 'user',
      },
      descarte: null,
    })
  })

  it('el final del mismo tramo quita lo provisional', () => {
    const resultado = construirFila(cierre({ final: true }))
    expect(resultado.fila?.provisional).toBe(false)
  })

  it('un tramo que no avanza o no tiene sampleRate se descarta contado', () => {
    expect(construirFila(cierre({ fin: 0 }))).toEqual({
      fila: null,
      descarte: 'tramoInvalido',
    })
    expect(construirFila(cierre({ fin: null }))).toEqual({
      fila: null,
      descarte: 'tramoInvalido',
    })
    expect(construirFila(cierre({ sampleRate: 0 }))).toEqual({
      fila: null,
      descarte: 'tramoInvalido',
    })
  })

  it('sin texto no hay fila', () => {
    expect(construirFila(cierre({ texto: '   ' }))).toEqual({
      fila: null,
      descarte: 'sinTexto',
    })
  })

  it('sin UUIDv4 no hay inserción', () => {
    expect(() => construirFila(cierre({ locutionId: 's1:1' }))).toThrow(/UUIDv4/)
  })

  it('no muta la entrada', () => {
    const original = cierre()
    const antes = JSON.stringify(original)
    construirFila(original)
    expect(JSON.stringify(original)).toBe(antes)
  })

  it('el almacén real rechaza una segunda fila de la misma locución', async () => {
    const almacen = crearAlmacenMemoria({ reloj: { ahora: () => 1000 } })
    const resultado = construirFila(cierre({ final: true }))
    expect(resultado.fila).not.toBeNull()
    if (!resultado.fila) return
    const guardada = await almacen.guardar(resultado.fila)
    expect(guardada).toMatchObject({ revision: 1, updated_at: 1000, deleted: false })
    await expect(almacen.guardar(resultado.fila)).rejects.toThrow(/duplicada/)
    expect(await almacen.leerSesion('s1')).toHaveLength(1)
  })
})

describe('promoción — el final del mismo tramo actualiza sin perder palabras', () => {
  it('un final más largo extiende el texto y quita provisional', () => {
    expect(promoverFila(filaPersistida('hola mundo'), 'hola mundo entero')).toEqual({
      texto: 'hola mundo entero',
      provisional: false,
    })
  })

  it('un final que pierde palabras conserva el texto y quita provisional', () => {
    expect(promoverFila(filaPersistida('hola mundo entero'), 'hola mundo')).toEqual({
      texto: 'hola mundo entero',
      provisional: false,
    })
  })

  it('una fila ya promovida con el mismo texto no se reescribe', () => {
    expect(promoverFila(filaPersistida('hola', { provisional: false }), 'hola')).toBeNull()
  })

  it('una fila ya promovida sí acepta un final más largo', () => {
    expect(
      promoverFila(filaPersistida('hola', { provisional: false }), 'hola mundo'),
    ).toEqual({ texto: 'hola mundo', provisional: false })
  })

  it('una fila borrada lógicamente no se promueve', () => {
    expect(promoverFila(filaPersistida('hola', { deleted: true }), 'hola mundo')).toBeNull()
  })
})
