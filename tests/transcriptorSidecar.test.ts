// @vitest-environment node
/**
 * transcriptorSidecar — el respaldo por tramo habla con el SIDECAR nativo
 * (faster-whisper) y la fila cae a Chrome cuando el servicio no está.
 *
 * Contrato medido aquí (docs/CONTRATO-ASR-LOCAL.md §5-octies):
 *  - el cable es JSON con PCM base64 float32 LITTLE-ENDIAN (`f32le`);
 *  - `GET /salud` decide disponibilidad; apagado/sin URL = NO disponible y el
 *    adaptador devuelve `deshabilitado` sin pagar la petición de transcripción;
 *  - el tope por ventana viaja en la petición y un transporte colgado resuelve
 *    `timeout` (nunca cuelga el cierre);
 *  - el texto aceptado pasa por la MISMA puerta del dueño
 *    (`classifyLocalResult`) y la misma fila/commit del módulo;
 *  - la URL vive en config y el camino del producto ya NO usa el modelo WASM
 *    por tramo (el módulo WASM sigue siendo dueño de la escucha viva).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  crearSidecarTranscripcion,
  pcmFloat32ABase64,
} from '../src/voice/lib/asr/sidecarTranscriber.ts'
import type {
  ClienteSidecar,
  EntradaTranscripcionSidecar,
  RespuestaTranscripcionSidecar,
} from '../src/voice/lib/asr/sidecarTranscriber.ts'
import { crearTranscriptorSidecarProducto } from '../src/voice/conversation/adapters.ts'
import type { EntradaRespaldoLocal } from '../src/voice/conversation/ports.ts'
import { getAsrConfig } from '../src/voice/lib/asr/asrConfig.js'
import { getLocalFallbackRuntimeConfig } from '../src/voice/lib/voiceLocalFallback.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const URL_SIDECAR = 'http://127.0.0.1:8765'

/** Decodifica base64 a float32 LE (espejo del contrato, para medir el cable). */
function base64AFloat32(b64: string): Float32Array {
  const bytes = Buffer.from(b64, 'base64')
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const salida = new Float32Array(bytes.byteLength / 4)
  for (let indice = 0; indice < salida.length; indice += 1) {
    salida[indice] = vista.getFloat32(indice * 4, true)
  }
  return salida
}

const respuesta = (cuerpo: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: async () => cuerpo }) as unknown as Response

const clienteFalso = (
  resultado: RespuestaTranscripcionSidecar = { texto: 'uno dos tres cuatro', motivo: null },
  disponible = true,
) => {
  const llamadas = { salud: 0, transcribir: [] as EntradaTranscripcionSidecar[] }
  const cliente: ClienteSidecar = {
    salud: async () => {
      llamadas.salud += 1
      return disponible
    },
    transcribir: async (entrada) => {
      llamadas.transcribir.push(entrada)
      return resultado
    },
  }
  return { cliente, llamadas }
}

const ENTRADA: EntradaRespaldoLocal = {
  // 4800 muestras a 48 kHz = 0,1 s; el adaptador remuestrea al rate del ASR.
  muestras: new Float32Array(4800).fill(0.1),
  sampleRate: 48000,
  idioma: 'es',
  vozMs: 1200,
  speechLikeMs: 900,
  audioSegundos: 12,
}

describe('cliente del sidecar — contrato del transporte', () => {
  it('codifica float32 LITTLE-ENDIAN (el contrato f32le) y vuelve intacto', () => {
    const muestras = new Float32Array([-1, -0.5, 0, 0.25, 1])
    const b64 = pcmFloat32ABase64(muestras)
    expect(base64AFloat32(b64)).toEqual(muestras)
    // 1.0 en float32 es 0x3F800000; en LE los bytes van 00 00 80 3F. Un
    // buffer big-endian los pondría al revés y este vector lo delata.
    expect([...Buffer.from(pcmFloat32ABase64(new Float32Array([1])), 'base64')]).toEqual([
      0x00, 0x00, 0x80, 0x3f,
    ])
  })

  it('salud: 2xx = disponible; estado no-ok, excepción o URL vacía = NO disponible', async () => {
    const urls: string[] = []
    const sano = crearSidecarTranscripcion({
      url: URL_SIDECAR,
      probeMs: 200,
      fetchImpl: (async (url: string) => {
        urls.push(String(url))
        return respuesta({}, true)
      }) as unknown as typeof fetch,
    })
    expect(await sano.salud()).toBe(true)
    expect(urls).toEqual([`${URL_SIDECAR}/salud`])

    const roto = crearSidecarTranscripcion({
      url: URL_SIDECAR,
      probeMs: 200,
      fetchImpl: (async () => respuesta({}, false, 503)) as unknown as typeof fetch,
    })
    expect(await roto.salud()).toBe(false)

    const caido = crearSidecarTranscripcion({
      url: URL_SIDECAR,
      probeMs: 200,
      fetchImpl: (async () => {
        throw new Error('apagado')
      }) as unknown as typeof fetch,
    })
    expect(await caido.salud()).toBe(false)

    let tocado = 0
    const sinUrl = crearSidecarTranscripcion({
      url: '',
      probeMs: 200,
      fetchImpl: (async () => {
        tocado += 1
        return respuesta({}, true)
      }) as unknown as typeof fetch,
    })
    expect(await sinUrl.salud()).toBe(false)
    expect(tocado).toBe(0)
  })

  it('transcribir: POST /transcribir con muestras, rate, idioma y formato f32le', async () => {
    const enviadas: Array<{ url: string; init?: RequestInit }> = []
    const cliente = crearSidecarTranscripcion({
      url: URL_SIDECAR,
      probeMs: 200,
      fetchImpl: (async (url: string, init?: RequestInit) => {
        enviadas.push({ url: String(url), init })
        return respuesta({ texto: 'hola desde el sidecar' })
      }) as unknown as typeof fetch,
    })
    const muestras = new Float32Array([0, 0.5, -0.5])
    const resultado = await cliente.transcribir({
      muestras,
      sampleRate: 16000,
      idioma: 'es',
      timeoutMs: 8000,
    })
    expect(resultado).toEqual({ texto: 'hola desde el sidecar', motivo: null })
    expect(enviadas).toHaveLength(1)
    expect(enviadas[0].url).toBe(`${URL_SIDECAR}/transcribir`)
    expect(enviadas[0].init?.method).toBe('POST')
    const cuerpo = JSON.parse(String(enviadas[0].init?.body)) as {
      muestras: string
      sampleRate: number
      idioma: string
      formato: string
    }
    expect(cuerpo.sampleRate).toBe(16000)
    expect(cuerpo.idioma).toBe('es')
    expect(cuerpo.formato).toBe('f32le')
    expect(base64AFloat32(cuerpo.muestras)).toEqual(muestras)
  })

  it('transcribir: HTTP no-ok y JSON inválido resuelven fallo; nunca rechaza', async () => {
    const noOk = crearSidecarTranscripcion({
      url: URL_SIDECAR,
      probeMs: 200,
      fetchImpl: (async () => respuesta({}, false, 500)) as unknown as typeof fetch,
    })
    const r1 = await noOk.transcribir({
      muestras: new Float32Array(16),
      sampleRate: 16000,
      idioma: 'es',
      timeoutMs: 8000,
    })
    expect(r1.motivo).toBe('fallo')

    const jsonRoto = crearSidecarTranscripcion({
      url: URL_SIDECAR,
      probeMs: 200,
      fetchImpl: (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error('no es json')
          },
        }) as unknown as Response) as unknown as typeof fetch,
    })
    const r2 = await jsonRoto.transcribir({
      muestras: new Float32Array(16),
      sampleRate: 16000,
      idioma: 'es',
      timeoutMs: 8000,
    })
    expect(r2.motivo).toBe('fallo')
  })

  it('transcribir: el tope por ventana aborta y resuelve timeout', async () => {
    const lento = crearSidecarTranscripcion({
      url: URL_SIDECAR,
      probeMs: 200,
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('abortado')))
        })) as unknown as typeof fetch,
    })
    const resultado = await lento.transcribir({
      muestras: new Float32Array(16),
      sampleRate: 16000,
      idioma: 'es',
      timeoutMs: 10,
    })
    expect(resultado).toEqual({ texto: '', motivo: 'timeout' })
  })
})

describe('adaptador del producto — misma puerta, misma fila, Chrome si no hay sidecar', () => {
  it('sin sidecar disponible devuelve deshabilitado SIN pagar la transcripción', async () => {
    const { cliente, llamadas } = clienteFalso(
      { texto: 'texto que no debe pedirse', motivo: null },
      false,
    )
    const transcriptor = crearTranscriptorSidecarProducto({ cliente })
    const resultado = await transcriptor.transcribir(ENTRADA)
    expect(resultado).toEqual({ texto: '', descarte: 'deshabilitado' })
    expect(llamadas.transcribir).toHaveLength(0)
  })

  it('con `localFinal.enabled` encendido el preload sondea y el cierre reusa la sonda', async () => {
    // Producto desde §5-nonies: el respaldo está encendido; la sonda se paga
    // una vez por apertura y el cierre espera la MISMA promesa.
    expect(getLocalFallbackRuntimeConfig().enabled).toBe(true)
    const { cliente, llamadas } = clienteFalso()
    const transcriptor = crearTranscriptorSidecarProducto({ cliente })
    transcriptor.preload()
    await transcriptor.transcribir(ENTRADA)
    expect(llamadas.salud).toBe(1)
    expect(llamadas.transcribir).toHaveLength(1)
  })

  it('con `localFinal.enabled` apagado el preload NO sondea (no se paga el servicio)', async () => {
    // El lector es vivo: se apaga SOLO en memoria y se restaura siempre.
    const local = FLU_CONFIG.transcript.localFinal as { enabled: boolean }
    const previo = local.enabled
    local.enabled = false
    try {
      const { cliente, llamadas } = clienteFalso()
      const transcriptor = crearTranscriptorSidecarProducto({ cliente })
      transcriptor.preload()
      expect(llamadas.salud).toBe(0)
    } finally {
      local.enabled = previo
    }
  })

  it('una sola sonda por apertura: el cierre no sondea por tramo', async () => {
    const { cliente, llamadas } = clienteFalso()
    const transcriptor = crearTranscriptorSidecarProducto({ cliente })
    await transcriptor.transcribir(ENTRADA)
    await transcriptor.transcribir(ENTRADA)
    expect(llamadas.salud).toBe(1)
    expect(llamadas.transcribir).toHaveLength(2)
  })

  it('remuestrea al rate del ASR y pasa el tope de config (8 s por ventana)', async () => {
    const { cliente, llamadas } = clienteFalso()
    const transcriptor = crearTranscriptorSidecarProducto({ cliente })
    await transcriptor.transcribir(ENTRADA)
    const enviada = llamadas.transcribir[0]
    const objetivo = Number(getAsrConfig().targetSampleRate)
    expect(enviada.sampleRate).toBe(objetivo)
    expect(enviada.muestras).toHaveLength(Math.floor(ENTRADA.muestras.length * (objetivo / 48000)))
    expect(enviada.timeoutMs).toBe(getLocalFallbackRuntimeConfig().timeoutMs)
    expect(enviada.timeoutMs).toBe(8000)
  })

  it('el texto aceptado viaja como resultado de la fila (puerta del dueño)', async () => {
    const { cliente } = clienteFalso({ texto: 'uno dos tres cuatro', motivo: null })
    const transcriptor = crearTranscriptorSidecarProducto({ cliente })
    expect(await transcriptor.transcribir(ENTRADA)).toEqual({
      texto: 'uno dos tres cuatro',
      descarte: null,
    })
  })

  it('la puerta del dueño rechaza: sin voz en el tramo no hay texto', async () => {
    const { cliente } = clienteFalso({ texto: 'texto con evidencia insuficiente', motivo: null })
    const transcriptor = crearTranscriptorSidecarProducto({ cliente })
    const resultado = await transcriptor.transcribir({ ...ENTRADA, vozMs: 100 })
    expect(resultado.descarte).toBe('sin-voz')
    expect(resultado.texto).toBe('')
  })

  it('timeout y fallo del transporte se propagan con su motivo', async () => {
    const conTimeout = crearTranscriptorSidecarProducto({
      cliente: clienteFalso({ texto: '', motivo: 'timeout' }).cliente,
    })
    expect((await conTimeout.transcribir(ENTRADA)).descarte).toBe('timeout')
    const conFallo = crearTranscriptorSidecarProducto({
      cliente: clienteFalso({ texto: '', motivo: 'fallo', error: '500' }).cliente,
    })
    expect((await conFallo.transcribir(ENTRADA)).descarte).toBe('fallo')
  })
})

describe('cableado — el camino del producto es el sidecar, no el WASM por tramo', () => {
  const leer = (ruta: string): string => readFileSync(join(process.cwd(), ruta), 'utf8')

  it('producto.ts cablea el adaptador del sidecar y retira el del WASM', () => {
    const producto = leer('src/voice/conversation/producto.ts')
    expect(producto).toContain('crearTranscriptorSidecarProducto(')
    expect(producto).not.toContain('crearTranscriptorWhisperProducto')
  })

  it('adapters.ts no importa el transcriptor WASM: la escucha viva sigue siendo su dueña', () => {
    const adapters = leer('src/voice/conversation/adapters.ts')
    expect(adapters).toContain('crearSidecarTranscripcion')
    expect(adapters).not.toContain('whisperWasmTranscriber')
  })

  it('la URL del sidecar vive en config, no en el cliente', () => {
    expect(leer('src/voice/lib/asr/sidecarTranscriber.ts')).not.toMatch(/https?:\/\//)
    expect(leer('src/voice/lib/fluConfig.js')).toContain('sidecarUrl:')
  })
})
