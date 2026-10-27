// @vitest-environment node
/**
 * CASOS 7+6 (CIERRE POR CONTENIDO, NO POR RELOJ) — guard de comportamiento.
 *
 * Hecho del encargo: 29/29 por frontera; la base 0,43–0,90 s es la ventana de
 * apertura, pero el tramo CERRADO del log mide 1,5–6,7 s: se mide el tramo
 * cerrado, no la apertura. ms/speechLikeMs/rms = null. Criterio:
 *
 *  - todo final trae ms, speechLikeMs y rms no nulos; si el motor no los da,
 *    el módulo los calcula desde el tramo cerrado (nada de null);
 *  - "frase completa" = el asrFinal del turno ya llegó y su ventana está
 *    DENTRO del tramo cerrado;
 *  - guard: final sin métricas => rojo; cierre por frontera con texto
 *    incompleto => rojo.
 *
 * Se mide con el MÓDULO REAL y el medidor REAL (`crearMedidorTramo`), con PCM
 * sintético modulado (un tono plano no pasa el criterio de habla): un final
 * con el tramo abierto NO cierra; el corte de 900 ms cierra por contenido con
 * causa 'final'. Sin final, el corte no cierra y el silencio de 5000 ms deja
 * la fila provisional. Los detectores viven en el código real (sin vaciedad).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crearConversacion } from '../src/voice/conversation/index'
import type {
  ConversacionApi,
  EventoConversacion,
} from '../src/voice/conversation/index'
import {
  crearAlmacenMemoria,
  crearIdUuid,
  crearMedidorTramo,
  crearPartidorWake,
} from '../src/voice/conversation/adapters'
import type { ConfigPort, MedidaVad } from '../src/voice/conversation/ports'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'

const SAMPLE_RATE = 16000
/** Muestras de 900 ms: el corte mínimo de la tabla del plan. */
const CORTE_MS = 900
const MUESTRAS_CORTE = Math.round((SAMPLE_RATE * CORTE_MS) / 1000)

const fuenteDe = (ruta: string): string =>
  readFileSync(join(process.cwd(), ruta), 'utf8')

/** El cierre MIDE el tramo cerrado con el medidor inyectado (cierre.ts). */
export function cierreMideTramoCerrado(src: string): boolean {
  return /medirTramoCerrado\(/.test(src) && /medidor\.medir\(/.test(src)
}

/** Los TRES emits de locution.closed llevan `medida` (consolidar/descarte/fila). */
export function losTresCierresLlevanMedida(src: string): boolean {
  const cierres = (src.match(/tipo: 'locution\.closed'/g) || []).length
  const medidas = (src.match(/^\s*medida,$/gm) || []).length
  return cierres === 3 && medidas >= 3
}

/** El producto pasa el final REAL del evento al módulo (dueño único traeFinal). */
export function productoPasaFinalReal(src: string): boolean {
  return /final:\s*hayFinal/.test(src) && !/final:\s*false/.test(src)
}

/** El texto NO cierra una locución cuyo tramo de audio sigue abierto. */
export function gateTramoAbiertoEnTexto(src: string): boolean {
  return /estado\.tramoAudio && estado\.tramoAudio\.tramoId === tramoId/.test(src)
}

/** La ventana del final se valida con el dueño único de fila.ts y se usa en texto.ts. */
export function ventanaDelFinalDentro(srcFila: string, srcTexto: string): boolean {
  return /export function ventanaDentroDe/.test(srcFila) && /ventanaDentroDe\(/.test(srcTexto)
}

/** El evento locution.closed declara `medida: MedidaFinal` (tipos.ts). */
export function medidaEnEventoCerrado(src: string): boolean {
  return /tipo: 'locution\.closed'[\s\S]*medida: MedidaFinal/.test(src)
}

const VOZ = (): MedidaVad => ({ hayVoz: true, silencioMs: 0 })
const SILENCIO = (silencioMs: number): MedidaVad => ({ hayVoz: false, silencioMs })

/**
 * PCM de 1 s CON MODULACIÓN de energía por trama (el criterio de habla exige
 * modulación: un tono plano tiene ratio ~1 y no cuenta). Amplitudes por trama
 * de 30 ms: ratio max/min = 2 > `speechLikeModulationMin` (1.15).
 */
function pcmVoz(): Float32Array {
  const muestras = new Float32Array(SAMPLE_RATE)
  const amplitudes = [0.5, 0.3, 0.45, 0.25]
  const trama = Math.round((SAMPLE_RATE * 30) / 1000)
  for (let i = 0; i < muestras.length; i += 1) {
    const indice = Math.floor(i / trama) % amplitudes.length
    muestras[i] = amplitudes[indice] * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE)
  }
  return muestras
}

type Escenario = Readonly<{ api: ConversacionApi; eventos: EventoConversacion[] }>

function crearEscenario(): Escenario {
  const reloj = { ahora: () => 1_700_000_000_000 }
  const config: ConfigPort = {
    wakeWords: () => ['ok flu'],
    semillaEtiqueta: () => 'Hablante 1',
    esEtiquetaAnonima: isAutoSpeakerLabel,
    umbralContinuidadVoz: () => 0.8,
    etiquetaAnonima: (indice) => `Hablante ${indice}`,
    echoMinPalabrasCola: () => 4,
  }
  const api = crearConversacion({
    reloj,
    id: crearIdUuid(),
    registro: { registrar: () => undefined },
    almacen: crearAlmacenMemoria({ reloj }),
    config,
    partidor: crearPartidorWake(config),
    medidor: crearMedidorTramo(),
    ultimoTextoDicho: () => '',
  })
  const eventos: EventoConversacion[] = []
  api.subscribe((evento) => eventos.push(evento))
  return { api, eventos }
}

/** Cierres emitidos de la sesión (causa declarada en cada uno). */
const cierresDe = (eventos: EventoConversacion[]): Array<Extract<EventoConversacion, { tipo: 'locution.closed' }>> =>
  eventos.filter((evento): evento is Extract<EventoConversacion, { tipo: 'locution.closed' }> =>
    evento.tipo === 'locution.closed',
  )

/** Abre la locución con PCM hablado y devuelve su `tramoId`. */
async function abrirConVoz(api: ConversacionApi): Promise<string> {
  const estado = await api.ingestAudio({
    muestras: pcmVoz(),
    sampleRate: SAMPLE_RATE,
    inicio: 0,
    fin: SAMPLE_RATE,
    medida: VOZ(),
  })
  if (!estado.locucionAbierta) throw new Error('el audio con voz no abrio locucion')
  return estado.locucionAbierta.locutionId
}

/** Corte de 900 ms que arranca EXACTAMENTE en el fin del tramo (no lo extiende). */
async function cortar(api: ConversacionApi, finTramo: number): Promise<void> {
  await api.ingestAudio({
    muestras: new Float32Array(MUESTRAS_CORTE),
    sampleRate: SAMPLE_RATE,
    inicio: finTramo,
    fin: finTramo + MUESTRAS_CORTE,
    medida: SILENCIO(CORTE_MS),
  })
}

describe('Caso 7+6 — cierre por contenido con el módulo real', () => {
  it('un final sin métricas cierra con medida COMPLETA del tramo (ms exacto, nunca null)', async () => {
    const { api, eventos } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr({ tramoId, texto: 'hola', final: true })
    await cortar(api, SAMPLE_RATE)

    const cerrados = cierresDe(eventos)
    expect(cerrados).toHaveLength(1)
    expect(cerrados[0]).toMatchObject({ locutionId: tramoId, causa: 'final' })
    // ms sale SIEMPRE del tramo cerrado (1 s => 1000 ms), no de la apertura.
    expect(cerrados[0].medida.ms).toBe(1000)
    expect(cerrados[0].medida.speechLikeMs).toBeGreaterThan(0)
    expect(cerrados[0].medida.rms).toBeGreaterThan(0.2)
  })

  it('las métricas del MOTOR pasan tal cual y el ms sigue siendo del tramo', async () => {
    const { api, eventos } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr({
      tramoId,
      texto: 'hola',
      final: true,
      medida: { speechLikeMs: 123, rms: 0.42 },
    })
    await cortar(api, SAMPLE_RATE)

    const cerrados = cierresDe(eventos)
    expect(cerrados).toHaveLength(1)
    expect(cerrados[0].medida).toEqual({ ms: 1000, speechLikeMs: 123, rms: 0.42 })
  })

  it('el final con el tramo abierto NO cierra: tres finales, una fila al corte', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    for (const texto of ['hola', 'hola mundo', 'hola mundo entero']) {
      const estado = await api.ingestAsr({ tramoId, texto, final: true })
      expect(estado.filas).toEqual([])
      expect(estado.box.abierta).toBe(true)
    }
    const estado = await api.ingestAudio({
      muestras: new Float32Array(MUESTRAS_CORTE),
      sampleRate: SAMPLE_RATE,
      inicio: SAMPLE_RATE,
      fin: SAMPLE_RATE + MUESTRAS_CORTE,
      medida: SILENCIO(CORTE_MS),
    })
    expect(estado.filas).toHaveLength(1)
    expect(estado.filas[0]).toMatchObject({ texto: 'hola mundo entero', provisional: false })
  })

  it('un final con la ventana FUERA del tramo no completa: el corte no cierra y el silencio deja provisional', async () => {
    const { api, eventos } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    const marcado = await api.ingestAsr({
      tramoId,
      texto: 'hola',
      final: true,
      tramo: { inicio: 2 * SAMPLE_RATE, fin: 3 * SAMPLE_RATE, sampleRate: SAMPLE_RATE },
    })
    expect(marcado.filas).toEqual([])
    await cortar(api, SAMPLE_RATE)
    expect(api.snapshot().filas).toEqual([])

    await api.ingestAudio({
      muestras: new Float32Array(5 * SAMPLE_RATE),
      sampleRate: SAMPLE_RATE,
      inicio: SAMPLE_RATE + MUESTRAS_CORTE,
      fin: SAMPLE_RATE + MUESTRAS_CORTE + 5 * SAMPLE_RATE,
      medida: SILENCIO(5000),
    })
    const cerrados = cierresDe(eventos)
    expect(cerrados).toHaveLength(1)
    expect(cerrados[0]).toMatchObject({ causa: 'silencio' })
    expect(cerrados[0].medida.ms).toBe(1000)
    expect(cerrados[0].medida.speechLikeMs).not.toBeNull()
    expect(cerrados[0].medida.rms).not.toBeNull()
    expect(api.snapshot().filas[0]).toMatchObject({ provisional: true })
  })

  it('falsifica el 29/29: con el final disponible el cierre es por CONTENIDO, no por frontera', async () => {
    const { api, eventos } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr({ tramoId, texto: 'hola', final: true })
    await cortar(api, SAMPLE_RATE)

    const cerrados = cierresDe(eventos)
    expect(cerrados).toHaveLength(1)
    expect(cerrados[0].causa).toBe('final')
    expect(cerrados[0].causa).not.toBe('frontera')
    expect(api.snapshot().filas[0]).toMatchObject({ provisional: false })
  })

  it('sin final el corte NO cierra: el silencio de 5000 ms cierra provisional con medida', async () => {
    const { api, eventos } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr({ tramoId, texto: 'hola', final: false })
    await cortar(api, SAMPLE_RATE)
    expect(api.snapshot().filas).toEqual([])
    expect(api.snapshot().box.abierta).toBe(true)

    await api.ingestAudio({
      muestras: new Float32Array(5 * SAMPLE_RATE),
      sampleRate: SAMPLE_RATE,
      inicio: SAMPLE_RATE + MUESTRAS_CORTE,
      fin: SAMPLE_RATE + MUESTRAS_CORTE + 5 * SAMPLE_RATE,
      medida: SILENCIO(5000),
    })
    const cerrados = cierresDe(eventos)
    expect(cerrados).toHaveLength(1)
    expect(cerrados[0]).toMatchObject({ causa: 'silencio' })
    expect(cerrados[0].medida.ms).toBe(1000)
    expect(api.snapshot().filas[0]).toMatchObject({ provisional: true })
  })
})

describe('Caso 7+6 — los dueños viven en el archivo real', () => {
  it('el cierre mide el tramo CERRADO con el medidor inyectado (cierre.ts)', () => {
    expect(cierreMideTramoCerrado(fuenteDe('src/voice/conversation/cierre.ts'))).toBe(true)
  })

  it('los TRES cierres de cierre.ts emiten medida (consolidar, descarte y fila)', () => {
    expect(losTresCierresLlevanMedida(fuenteDe('src/voice/conversation/cierre.ts'))).toBe(true)
  })

  it('el producto pasa el final REAL del evento (producto.ts)', () => {
    expect(productoPasaFinalReal(fuenteDe('src/voice/conversation/producto.ts'))).toBe(true)
  })

  it('el texto no cierra una locución con el tramo de audio abierto (texto.ts)', () => {
    expect(gateTramoAbiertoEnTexto(fuenteDe('src/voice/conversation/texto.ts'))).toBe(true)
  })

  it('la ventana del final se valida con el dueño único (fila.ts + texto.ts)', () => {
    expect(
      ventanaDelFinalDentro(
        fuenteDe('src/voice/conversation/fila.ts'),
        fuenteDe('src/voice/conversation/texto.ts'),
      ),
    ).toBe(true)
  })

  it('el evento locution.closed declara medida: MedidaFinal (tipos.ts)', () => {
    expect(medidaEnEventoCerrado(fuenteDe('src/voice/conversation/tipos.ts'))).toBe(true)
  })
})

describe('Caso 7+6 — PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('un cierre sin medirTramoCerrado ni medidor.medir => rojo; con ambos => verde', () => {
    const sinMedida =
      'const medida = { ms: ((fin - inicio) / sr) * 1000, speechLikeMs: 0, rms: 0 }'
    expect(cierreMideTramoCerrado(sinMedida)).toBe(false)
    const conMedida =
      'const medidaTramo = medirTramoCerrado(tramo, estado.muestrasAbierta, medidor)\n  medidor.medir(bloques, tramo.sampleRate)'
    expect(cierreMideTramoCerrado(conMedida)).toBe(true)
  })

  it('un emit de locution.closed sin medida => rojo; tres cierres con medida => verde', () => {
    const sinMedida = "emitir({ tipo: 'locution.closed', tramo, motivo, causa })\n".repeat(3)
    expect(losTresCierresLlevanMedida(sinMedida)).toBe(false)
    const conMedida = "emitir({\n  tipo: 'locution.closed',\n  medida,\n})\n".repeat(3)
    expect(losTresCierresLlevanMedida(conMedida)).toBe(true)
  })

  it('un producto que hardcodea final:false => rojo; final:hayFinal => verde', () => {
    expect(productoPasaFinalReal('final: false,\nidioma,')).toBe(false)
    expect(productoPasaFinalReal('final: hayFinal,\nidioma,')).toBe(true)
  })

  it('un texto que cierra sin gate de tramo abierto => rojo; con el gate => verde', () => {
    const sinGate = 'if (completa) await sesion.cerrarLocucion(locucion, \'system\', \'final\', true)'
    expect(gateTramoAbiertoEnTexto(sinGate)).toBe(false)
    const conGate =
      'const tramoAbierto = Boolean(estado.tramoAudio && estado.tramoAudio.tramoId === tramoId)\nif (completa && !tramoAbierto) await sesion.cerrarLocucion(locucion, \'system\', \'final\', true)'
    expect(gateTramoAbiertoEnTexto(conGate)).toBe(true)
  })

  it('una ventana del final sin dueño único => rojo; con fila.ts + texto.ts => verde', () => {
    expect(ventanaDelFinalDentro('const dentro = (v, t) => v.inicio >= t.inicio', '')).toBe(false)
    expect(
      ventanaDelFinalDentro(
        'export function ventanaDentroDe(ventana, tramo) {}',
        'ventanaDentroDe(entrada.tramo, { inicio: abierta.inicio })',
      ),
    ).toBe(true)
  })

  it('un evento cerrado sin medida: MedidaFinal => rojo; con ella => verde', () => {
    expect(medidaEnEventoCerrado("tipo: 'locution.closed'\n  tramo\n  motivo\n  causa\n}")).toBe(false)
    expect(
      medidaEnEventoCerrado("tipo: 'locution.closed'\n  tramo\n  motivo\n  causa\n  medida: MedidaFinal\n}"),
    ).toBe(true)
  })
})
