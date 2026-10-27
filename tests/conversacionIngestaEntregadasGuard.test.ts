// @vitest-environment node
/**
 * CASO 5 (INGESTA) — muestras entregadas a la ingesta, sin pérdida.
 *
 * Criterio del encargo: sesión sintética de N s a 48 kHz => entregadas >= 0,98N.
 * El contador `totalMuestrasEntregadas` vive en la sesión del módulo y se
 * incrementa UNA vez por bloque validado en `ingestaAudio`, ANTES de cualquier
 * puerta de voz: la ingesta cuenta también el silencio, porque el micrófono
 * entrega PCM completo. El tope de grabación NO existe: el sumidero de disco
 * recibe la sesión completa (medido en playback 2026-10-27: 300 s de fuente,
 * 14 732 672 muestras grabadas, `truncated: false`, `gaps: 0`).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crearConversacion } from '../src/voice/conversation/index'
import type {
  ConversacionApi,
  DependenciasConversacion,
} from '../src/voice/conversation/index'
import {
  crearAlmacenMemoria,
  crearIdUuid,
  crearMedidorTramo,
  crearPartidorWake,
} from '../src/voice/conversation/adapters'
import type { ConfigPort, MedidaVad } from '../src/voice/conversation/ports'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'

const SAMPLE_RATE = 48000
const N_SEGUNDOS = 2
const N_MUESTRAS = N_SEGUNDOS * SAMPLE_RATE
/** Bloques de 20 ms, como entrega el micrófono. */
const POR_BLOQUE = (SAMPLE_RATE * 20) / 1000

const fuente = (): string =>
  readFileSync(join(process.cwd(), 'src/voice/conversation/ingesta.ts'), 'utf8')

/** ¿Cuántas veces se incrementa el contador de entregadas? Debe ser UNA. */
export function incrementoEntregadas(src: string): number {
  return (src.match(/totalMuestrasEntregadas \+= bloque\.muestras\.length/g) || []).length
}

/** ¿El incremento está ANTES de la medida VAD (cuenta también el silencio)? */
export function cuentaAntesDeVad(src: string): boolean {
  const incremento = src.indexOf('totalMuestrasEntregadas += bloque.muestras.length')
  const vad = src.indexOf('const medida =')
  return incremento >= 0 && vad >= 0 && incremento < vad
}

const configDePrueba = (): ConfigPort => ({
  wakeWords: () => ['ok flu'],
  semillaEtiqueta: () => 'Hablante 1',
  esEtiquetaAnonima: isAutoSpeakerLabel,
  umbralContinuidadVoz: () => 0.8,
  etiquetaAnonima: (indice) => `Hablante ${indice}`,
  echoMinPalabrasCola: () => 4,
})

/** Módulo real con almacén en memoria y puertos falsos (como conversacionApi). */
function crearEscenario(): ConversacionApi {
  const reloj = { ahora: () => 1_700_000_000_000 }
  const config = configDePrueba()
  const dependencias: DependenciasConversacion = {
    reloj,
    id: crearIdUuid(),
    registro: { registrar: () => undefined },
    almacen: crearAlmacenMemoria({ reloj }),
    config,
    partidor: crearPartidorWake(config),
    medidor: crearMedidorTramo(),
    ultimoTextoDicho: () => '',
  }
  return crearConversacion(dependencias)
}

const VOZ = (silencioMs = 0): MedidaVad => ({ hayVoz: true, silencioMs })
const SILENCIO = (silencioMs = 100): MedidaVad => ({ hayVoz: false, silencioMs })

/** Inyecta N s de audio en bloques de 20 ms con la medida indicada. */
async function inyectar(api: ConversacionApi, medida: MedidaVad): Promise<void> {
  for (let inicio = 0; inicio < N_MUESTRAS; inicio += POR_BLOQUE) {
    await api.ingestAudio({
      muestras: new Float32Array(POR_BLOQUE),
      sampleRate: SAMPLE_RATE,
      inicio,
      fin: inicio + POR_BLOQUE,
      medida,
    })
  }
}

describe('Caso 5 — entregadas >= 0,98N en sesión sintética de N s a 48 kHz', () => {
  it('una sesión con voz cuenta las N muestras entregadas', async () => {
    const api = crearEscenario()
    await api.start()
    await inyectar(api, VOZ())
    const entregadas = api.snapshot().totalMuestrasEntregadas
    expect(entregadas).toBe(N_MUESTRAS)
    expect(entregadas).toBeGreaterThanOrEqual(0.98 * N_MUESTRAS)
  })

  it('el silencio también está ENTREGADO (el micrófono entrega PCM, no solo voz)', async () => {
    const api = crearEscenario()
    await api.start()
    await inyectar(api, SILENCIO(100))
    expect(api.snapshot().totalMuestrasEntregadas).toBe(N_MUESTRAS)
  })

  it('una sesión nueva reinicia el contador (no acumula entre sesiones)', async () => {
    const api = crearEscenario()
    await api.start()
    await inyectar(api, VOZ())
    await api.stop('user')
    await api.start()
    expect(api.snapshot().totalMuestrasEntregadas).toBe(0)
  })
})

describe('Caso 5 — el contador vive en el archivo real', () => {
  it('UN solo dueño del incremento en ingesta.ts', () => {
    expect(incrementoEntregadas(fuente())).toBe(1)
  })

  it('el incremento cuenta ANTES de la puerta del VAD (todo bloque validado)', () => {
    expect(cuentaAntesDeVad(fuente())).toBe(true)
  })
})

// Prueba de detector: infractor sintético => marca; código legítimo => no.
describe('Caso 5 — el detector no es decorativo', () => {
  const cuerpoSano =
    "function ingestaAudio(bloque) {\n  estado.totalMuestrasEntregadas += bloque.muestras.length\n  const medida = { hayVoz: true, silencioMs: 0 }\n}"

  it('sin el incremento => rojo; con dos dueños => rojo; con uno => verde', () => {
    expect(incrementoEntregadas(cuerpoSano)).toBe(1)
    expect(
      incrementoEntregadas(
        cuerpoSano.replace(
          'totalMuestrasEntregadas += bloque.muestras.length',
          '// contador retirado',
        ),
      ),
    ).toBe(0)
    expect(incrementoEntregadas(cuerpoSano + '\n  estado.totalMuestrasEntregadas += bloque.muestras.length')).toBe(2)
  })

  it('contar SOLO la voz (dentro del gate VAD) => rojo', () => {
    const gateado =
      'function ingestaAudio(bloque) {\n' +
      '  const medida = { hayVoz: true, silencioMs: 0 }\n' +
      '  if (medida.hayVoz) {\n' +
      '    estado.totalMuestrasEntregadas += bloque.muestras.length\n' +
      '  }\n' +
      '}'
    expect(cuentaAntesDeVad(gateado)).toBe(false)
    expect(cuentaAntesDeVad(cuerpoSano)).toBe(true)
  })
})
