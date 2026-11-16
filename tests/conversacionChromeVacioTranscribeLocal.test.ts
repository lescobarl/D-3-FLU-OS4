// @vitest-environment node
/**
 * FASE B — Chrome MUDO: una locución que cierra con VOZ medida y TEXTO vacío se
 * transcribe desde su PCM retenido (transcriptor inyectado) y produce fila
 * local. Si el transcriptor falla, se conserva el `sinTexto` con motivo.
 *
 * Se monta el MÓDULO REAL (crearConversacion + adaptadores reales de memoria,
 * medidor y partidor) con PCM sintético modulado; solo el transcriptor es un
 * doble determinista (la dependencia pesada, Whisper WASM, no corre en node).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crearConversacion, esFilaNoAccionable } from '../src/voice/conversation/index'
import type {
  ConversacionApi,
  DependenciasConversacion,
  EventoConversacion,
} from '../src/voice/conversation/index'
import {
  crearAlmacenMemoria,
  crearIdUuid,
  crearMedidorTramo,
  crearPartidorWake,
} from '../src/voice/conversation/adapters'
import { CONVERSACION_CONFIG } from '../src/voice/conversation/ports'
import type { ConfigPort, MedidaVad } from '../src/voice/conversation/ports'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'

const SAMPLE_RATE = 16000
const CORTE_MS = 900
const MUESTRAS_CORTE = Math.round((SAMPLE_RATE * CORTE_MS) / 1000)

const VOZ = (): MedidaVad => ({ hayVoz: true, silencioMs: 0 })
const SILENCIO = (silencioMs: number): MedidaVad => ({ hayVoz: false, silencioMs })

/** PCM de 1 s con modulación de energía (habla real para el medidor). */
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

/** Tono modulado de `ms` (habla para el VAD/medidor). */
function tono(ms: number): Float32Array {
  const n = Math.round((SAMPLE_RATE * ms) / 1000)
  const muestras = new Float32Array(n)
  const amplitudes = [0.5, 0.3, 0.45, 0.25]
  const trama = Math.round((SAMPLE_RATE * 30) / 1000)
  for (let i = 0; i < n; i += 1) {
    const indice = Math.floor(i / trama) % amplitudes.length
    muestras[i] = amplitudes[indice] * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE)
  }
  return muestras
}

type TranscriptorDoble = Readonly<{
  transcribir: (entrada: {
    muestras: Float32Array
    sampleRate: number
  }) => Promise<string>
}>

function crearEscenario(
  transcriptorTramo?: TranscriptorDoble,
  configuracion?: typeof CONVERSACION_CONFIG,
): {
  api: ConversacionApi
  eventos: EventoConversacion[]
  registro: { contextos: string[] }
} {
  let ahora = 1_700_000_000_000
  const reloj = {
    ahora: () => ahora,
    avanzar: (ms: number): void => {
      ahora += ms
    },
  }
  const config: ConfigPort = {
    wakeWords: () => ['ok flu'],
    semillaEtiqueta: () => 'Hablante 1',
    esEtiquetaAnonima: isAutoSpeakerLabel,
    umbralContinuidadVoz: () => 0.8,
    etiquetaAnonima: (indice) => `Hablante ${indice}`,
    echoMinPalabrasCola: () => 4,
  }
  const registro = { contextos: [] as string[] }
  const dependencias: DependenciasConversacion = {
    reloj,
    id: crearIdUuid(),
    registro: { registrar: (contexto) => registro.contextos.push(contexto) },
    almacen: crearAlmacenMemoria({ reloj }),
    config,
    partidor: crearPartidorWake(config),
    medidor: crearMedidorTramo(),
    ultimoTextoDicho: () => '',
    ...(transcriptorTramo ? { transcriptorTramo } : {}),
    ...(configuracion ? { configuracion } : {}),
  }
  const api = crearConversacion(dependencias)
  const eventos: EventoConversacion[] = []
  api.subscribe((evento) => eventos.push(evento))
  return { api, eventos, registro }
}

/** Abre una locución con voz, la corta y la cierra por silencio: cero ASR. */
async function cerrarVaciaConVoz(api: ConversacionApi): Promise<void> {
  await api.ingestAudio({
    muestras: pcmVoz(),
    sampleRate: SAMPLE_RATE,
    inicio: 0,
    fin: SAMPLE_RATE,
    medida: VOZ(),
  })
  await api.ingestAudio({
    muestras: new Float32Array(MUESTRAS_CORTE),
    sampleRate: SAMPLE_RATE,
    inicio: SAMPLE_RATE,
    fin: SAMPLE_RATE + MUESTRAS_CORTE,
    medida: SILENCIO(CORTE_MS),
  })
  await api.ingestAudio({
    muestras: new Float32Array(5 * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
    inicio: SAMPLE_RATE + MUESTRAS_CORTE,
    fin: SAMPLE_RATE + MUESTRAS_CORTE + 5 * SAMPLE_RATE,
    medida: SILENCIO(5000),
  })
}

/** Emite `ms` de VOZ en bloques de 100 ms desde `desdeMuestras`; devuelve el cursor. */
async function emitirVoz(
  api: ConversacionApi,
  desdeMuestras: number,
  ms: number,
): Promise<number> {
  const bloque = Math.round((SAMPLE_RATE * 100) / 1000)
  let cursor = desdeMuestras
  const bloques = Math.round(ms / 100)
  for (let i = 0; i < bloques; i += 1) {
    await api.ingestAudio({
      muestras: tono(100),
      sampleRate: SAMPLE_RATE,
      inicio: cursor,
      fin: cursor + bloque,
      medida: VOZ(),
    })
    cursor += bloque
  }
  return cursor
}

/** Espera a que el commit local ASÍNCRONO aterrice (la tubería no bloquea). */
async function esperar(condicion: () => boolean, timeoutMs = 2000): Promise<void> {
  const inicio = Date.now()
  while (!condicion()) {
    if (Date.now() - inicio > timeoutMs) throw new Error('tiempo de espera agotado')
    await new Promise((resolver) => setTimeout(resolver, 5))
  }
}

describe('Chrome mudo — el PCM se transcribe local (Fase B)', () => {
  it('voz + cero ASR + cierre -> UNA fila local, cero sinTexto', async () => {
    const { api, eventos } = crearEscenario({
      transcribir: async () => 'hola desde local',
    })
    await api.start()
    await cerrarVaciaConVoz(api)
    await esperar(() => api.snapshot().filas.length === 1)

    const estado = api.snapshot()
    expect(estado.filas.map((fila) => fila.texto)).toEqual(['hola desde local'])
    expect(estado.filas[0].origenTranscripcion).toBe('local')
    expect(estado.descartes).toEqual([])

    const filas = eventos.filter(
      (evento): evento is Extract<EventoConversacion, { tipo: 'row.committed' }> =>
        evento.tipo === 'row.committed',
    )
    expect(filas).toHaveLength(1)
    // La fila local es NO accionable por el predicado único.
    expect(esFilaNoAccionable(filas[0].fila)).toBe(true)
  })

  it('la fila local NO es accionable (predicado, no cadena)', () => {
    expect(esFilaNoAccionable({ origenTranscripcion: 'local' })).toBe(true)
    expect(esFilaNoAccionable({ origenTranscripcion: 'chrome' })).toBe(false)
    expect(esFilaNoAccionable({})).toBe(false)
    // La puerta ÚNICA de despacho usa el predicado; no compara la cadena.
    const compose = readFileSync(
      join(process.cwd(), 'src/voice/compose/conversationMotorProducto.js'),
      'utf8',
    )
    expect(compose).toContain('esFilaNoAccionable(evento.fila)')
    expect(compose).not.toContain("origenTranscripcion === 'local'")
  })

  it('transcriptor que falla -> sinTexto y motivo registrado', async () => {
    const { api, registro } = crearEscenario({
      transcribir: async () => {
        throw new Error('boom')
      },
    })
    await api.start()
    await cerrarVaciaConVoz(api)
    await esperar(() => api.snapshot().descartes.length === 1)

    const estado = api.snapshot()
    expect(estado.filas).toEqual([])
    expect(estado.descartes).toEqual([expect.objectContaining({ motivo: 'sinTexto' })])
    expect(registro.contextos).toContain('conversacion.transcripcion.local.fallo')
  })

  it('13 s de voz continua SIN ASR -> tope a 12 s con fila local, cero sinTexto', async () => {
    const { api, eventos } = crearEscenario({ transcribir: async () => 'uno dos' })
    await api.start()
    await emitirVoz(api, 0, 13_000)
    await esperar(() => api.snapshot().filas.length === 1)

    const cierres = eventos.filter(
      (evento): evento is Extract<EventoConversacion, { tipo: 'locution.closed' }> =>
        evento.tipo === 'locution.closed',
    )
    const filas = eventos.filter(
      (evento): evento is Extract<EventoConversacion, { tipo: 'row.committed' }> =>
        evento.tipo === 'row.committed',
    )
    expect(cierres.map((cierre) => cierre.causa)).toContain('maximo')
    expect(filas).toHaveLength(1)
    expect(filas[0].fila.texto).toBe('uno dos')
    expect(filas[0].fila.origenTranscripcion).toBe('local')
    expect(api.snapshot().descartes).toEqual([])
    // La segunda ventana no hereda el prefijo ya commiteado.
    expect(String(api.snapshot().locucionAbierta?.texto ?? '')).not.toContain('uno dos')
  })

  it('doble que NUNCA resuelve -> sinTexto con motivo y el motor no se bloquea', async () => {
    const { api, registro } = crearEscenario(
      { transcribir: () => new Promise<string>(() => {}) },
      { ...CONVERSACION_CONFIG, transcriptorTramoTimeoutMs: 25 },
    )
    await api.start()
    await emitirVoz(api, 0, 13_000)
    await esperar(() => api.snapshot().descartes.length >= 1)

    expect(api.snapshot().descartes).toContainEqual(
      expect.objectContaining({ motivo: 'sinTexto' }),
    )
    expect(registro.contextos).toContain('conversacion.transcripcion.local.fallo')
    // El motor siguió: la ventana siguiente está abierta.
    expect(api.snapshot().locucionAbierta).not.toBeNull()
  })

  it('texto local que no pasa la compuerta de plausibilidad -> sinTexto', async () => {
    const { api, registro } = crearEscenario({ transcribir: async () => 'ok' })
    await api.start()
    await cerrarVaciaConVoz(api)
    await esperar(() => api.snapshot().descartes.length === 1)

    expect(api.snapshot().filas).toEqual([])
    expect(api.snapshot().descartes).toContainEqual(
      expect.objectContaining({ motivo: 'sinTexto' }),
    )
    expect(registro.contextos).toContain('conversacion.transcripcion.local.descartada')
  })
})
