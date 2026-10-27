// @vitest-environment node
/**
 * CASO 9 (DESCARTES CON MOTIVO) — guard de comportamiento.
 *
 * Criterio del encargo:
 *  - el cierre lleva SIEMPRE motivo/causa (nunca un cierre mudo);
 *  - `descarte:null` es válido SOLO si se commiteó texto; si se tira texto, el
 *    descarte se cuenta CON su motivo (tramoInvalido / sinTexto / eco /
 *    huerfano), nunca null;
 *  - la caja de última frase == última fila commiteada al detener (el stop
 *    nunca pierde el texto de la caja).
 *
 * Se mide con el MÓDULO REAL y el medidor REAL (`crearMedidorTramo`), con PCM
 * sintético modulado: se ejercitan las 5 causas de cierre (final, silencio,
 * frontera, stop, asr por watchdog) y las rutas de descarte (eco, huérfano,
 * sinTexto, tramo inválido puro). Los detectores viven en el código real (sin
 * vaciedad) con su prueba de mutación.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crearConversacion } from '../src/voice/conversation/index'
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
import { construirFila } from '../src/voice/conversation/fila.ts'
import type { CierreLocucion } from '../src/voice/conversation/fila.ts'
import { CONVERSACION_CONFIG } from '../src/voice/conversation/ports'
import type {
  AsrPort,
  ConfigPort,
  EstadoAsr,
  MedidaVad,
  MotivoCierre,
} from '../src/voice/conversation/ports'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'

const SAMPLE_RATE = 16000
/** Muestras de 900 ms: el corte mínimo de la tabla del plan. */
const CORTE_MS = 900
const MUESTRAS_CORTE = Math.round((SAMPLE_RATE * CORTE_MS) / 1000)

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

const MOTIVOS_CIERRE: readonly MotivoCierre[] = ['user', 'system', 'watchdog']
const CAUSAS_CIERRE = ['final', 'frontera', 'silencio', 'stop', 'asr'] as const
const MOTIVOS_DESCARTE = ['tramoInvalido', 'sinTexto', 'eco', 'huerfano'] as const

const fuenteDe = (ruta: string): string =>
  readFileSync(join(process.cwd(), ruta), 'utf8')

/** ¿Los TRES emits de locution.closed de cierre.ts llevan motivo y causa? */
export function cierreSiempreMotivoYCausa(src: string): boolean {
  const bloques = src.split("tipo: 'locution.closed'")
  if (bloques.length !== 4) return false
  return bloques.slice(1).every((bloque) => /motivo,/.test(bloque) && /causa,/.test(bloque))
}

/**
 * ¿`descarte: null` aparece SOLO junto a una fila, nunca junto a `fila: null`?
 * En fila.ts el literal vive DOS veces (la unión de tipo y el return de la rama
 * commiteada); la regla es que ninguna de ellas sigue a un `fila: null` cercano.
 */
export function descarteNullSoloConFilaCommiteada(src: string): boolean {
  const nulos = (src.match(/descarte: null/g) || []).length
  if (nulos === 0) return false
  return !/fila: null[\s\S]{0,80}?descarte: null/.test(src)
}

/** ¿Los motivos del descarte viven tipados y no nulables (tipos.ts)? */
export function motivosDeDescarteTipados(src: string): boolean {
  const union =
    /export type MotivoDescarteConversacion =[\s\S]{0,200}?'tramoInvalido'[\s\S]{0,200}?'sinTexto'[\s\S]{0,200}?'eco'[\s\S]{0,200}?'huerfano'/.test(
      src,
    )
  const campo = /motivo: MotivoDescarteConversacion(?!\s*\|\s*null)/.test(src)
  return union && campo
}

/** ¿El descarte se REGISTRA con su motivo (sesion.ts, nunca silencioso)? */
export function descarteRegistradoConMotivo(src: string): boolean {
  return /registrar\('conversacion\.descarte', \{[\s\S]{0,300}?motivo,/.test(src)
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

type Escenario = Readonly<{
  api: ConversacionApi
  eventos: EventoConversacion[]
  registro: { contextos: string[] }
  reloj: { ahora: () => number; avanzar: (ms: number) => void }
}>

function crearEscenario(extra: Partial<DependenciasConversacion> = {}): Escenario {
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
    ...extra,
  }
  const api = crearConversacion(dependencias)
  const eventos: EventoConversacion[] = []
  api.subscribe((evento) => eventos.push(evento))
  return { api, eventos, registro, reloj }
}

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

/** Cierres emitidos de la sesión (motivo y causa declarados en cada uno). */
const cierresDe = (
  eventos: EventoConversacion[],
): Array<Extract<EventoConversacion, { tipo: 'locution.closed' }>> =>
  eventos.filter((evento): evento is Extract<EventoConversacion, { tipo: 'locution.closed' }> =>
    evento.tipo === 'locution.closed',
  )

/** Stub de ASR que avisa watchdog a voluntad: la causa 'asr' es medible. */
function crearAsrWatchdog(): { port: AsrPort; avisar: (estado: EstadoAsr) => void } {
  let avisador: ((estado: EstadoAsr, detalle?: string) => void) | null = null
  const port: AsrPort = {
    soportado: () => true,
    iniciar: async (opciones) => {
      avisador = opciones.alEstado
      return 'active'
    },
    detener: () => {},
    abortar: () => {},
    empujarAudio: () => {},
  }
  return { port, avisar: (estado) => avisador?.(estado) }
}

describe('Caso 9 — cada cierre declara motivo y causa (5 causas con el módulo real)', () => {
  it('final: el corte con final cierra por contenido con causa final', async () => {
    const { api, eventos } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr({ tramoId, texto: 'hola', final: true })
    await cortar(api, SAMPLE_RATE)

    const cerrados = cierresDe(eventos)
    expect(cerrados).toHaveLength(1)
    expect(cerrados[0]).toMatchObject({ motivo: 'system', causa: 'final' })
  })

  it('silencio: sin final, el reloj cierra provisional con causa silencio', async () => {
    const { api, eventos } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr({ tramoId, texto: 'hola', final: false })
    await cortar(api, SAMPLE_RATE)
    await api.ingestAudio({
      muestras: new Float32Array(5 * SAMPLE_RATE),
      sampleRate: SAMPLE_RATE,
      inicio: SAMPLE_RATE + MUESTRAS_CORTE,
      fin: SAMPLE_RATE + MUESTRAS_CORTE + 5 * SAMPLE_RATE,
      medida: SILENCIO(5000),
    })

    const cerrados = cierresDe(eventos)
    expect(cerrados).toHaveLength(1)
    expect(cerrados[0]).toMatchObject({ motivo: 'system', causa: 'silencio' })
  })

  it('frontera: el texto ajeno con pausa cierra la locución anterior', async () => {
    const { api, eventos } = crearEscenario()
    await api.start()
    const tramoUno = await abrirConVoz(api)
    await api.ingestAsr({ tramoId: tramoUno, texto: 'uno', final: false })
    await cortar(api, SAMPLE_RATE)
    await api.ingestAudio({
      muestras: pcmVoz(),
      sampleRate: SAMPLE_RATE,
      inicio: SAMPLE_RATE + MUESTRAS_CORTE,
      fin: 2 * SAMPLE_RATE + MUESTRAS_CORTE,
      medida: VOZ(),
    })
    await api.ingestAsr({
      tramoId: '',
      texto: 'dos',
      final: true,
      tramo: {
        inicio: SAMPLE_RATE + MUESTRAS_CORTE,
        fin: 2 * SAMPLE_RATE + MUESTRAS_CORTE,
        sampleRate: SAMPLE_RATE,
      },
    })

    const cerrados = cierresDe(eventos)
    expect(cerrados).toHaveLength(1)
    expect(cerrados[0]).toMatchObject({ motivo: 'system', causa: 'frontera' })
  })

  it('stop: el cierre de usuario declara su motivo', async () => {
    const { api, eventos } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr({ tramoId, texto: 'hola', final: false })
    await api.stop('user')

    const cerrados = cierresDe(eventos)
    expect(cerrados).toHaveLength(1)
    expect(cerrados[0]).toMatchObject({ motivo: 'user', causa: 'stop' })
  })

  it('asr: el watchdog cierra con su motivo declarado', async () => {
    const watchdog = crearAsrWatchdog()
    const { api, eventos } = crearEscenario({
      asr: watchdog.port,
      configuracion: { ...CONVERSACION_CONFIG, asr: { engine: 'local', lang: 'es' } },
    })
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr({ tramoId, texto: 'hola', final: false })
    watchdog.avisar('watchdog')
    await api.ingestAudio({
      muestras: pcmVoz(),
      sampleRate: SAMPLE_RATE,
      inicio: SAMPLE_RATE,
      fin: 2 * SAMPLE_RATE,
      medida: VOZ(),
    })

    const cerrados = cierresDe(eventos)
    expect(cerrados.some((cerrado) => cerrado.motivo === 'watchdog' && cerrado.causa === 'asr')).toBe(true)
  })

  it('todos los cierres emitidos llevan motivo y causa dentro de su union', async () => {
    const { api, eventos } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr({ tramoId, texto: 'hola', final: true })
    await cortar(api, SAMPLE_RATE)
    await api.stop('system')

    for (const cerrado of cierresDe(eventos)) {
      expect(MOTIVOS_CIERRE).toContain(cerrado.motivo)
      expect(CAUSAS_CIERRE).toContain(cerrado.causa)
    }
    expect(cierresDe(eventos).length).toBeGreaterThan(0)
  })
})

describe('Caso 9 — todo descarte se cuenta con su motivo, nunca null', () => {
  it('eco: el texto de FLU se descarta contado con motivo eco', async () => {
    const { api, registro } = crearEscenario({ ultimoTextoDicho: () => 'hola mundo entero' })
    await api.start()
    const tramoId = await abrirConVoz(api)
    const estado = await api.ingestAsr({ tramoId, texto: 'mundo entero', final: true })
    expect(estado.filas).toEqual([])
    expect(estado.descartes).toEqual([expect.objectContaining({ motivo: 'eco' })])
    for (const descarte of estado.descartes) expect(MOTIVOS_DESCARTE).toContain(descarte.motivo)
    expect(registro.contextos).toContain('conversacion.descarte')
  })

  it('huerfano: el texto sin tramo expira contado con motivo huerfano', async () => {
    const { api, reloj } = crearEscenario()
    await api.start()
    const antes = await api.ingestAsr({ tramoId: UUID_A, texto: 'viejo', final: true })
    expect(antes.filas).toEqual([])
    expect(antes.box.abierta).toBe(false)

    reloj.avanzar(CONVERSACION_CONFIG.orphanBufferMs + 1)
    const despues = await api.ingestAsr({
      tramoId: UUID_B,
      texto: 'nuevo',
      final: true,
      tramo: { inicio: 0, fin: SAMPLE_RATE, sampleRate: SAMPLE_RATE },
    })
    expect(despues.filas.map((fila) => fila.texto)).toEqual(['nuevo'])
    expect(despues.descartes).toContainEqual(
      expect.objectContaining({ motivo: 'huerfano', locutionId: UUID_A }),
    )
  })

  it('sinTexto: el stop sin texto cuenta el descarte y no inventa fila', async () => {
    const { api } = crearEscenario()
    await api.start()
    await abrirConVoz(api)
    const estado = await api.stop('system')
    expect(estado.filas).toEqual([])
    expect(estado.descartes).toEqual([expect.objectContaining({ motivo: 'sinTexto' })])
  })

  it('tramoInvalido: la fila pura declara el motivo en vez de null (construirFila)', () => {
    const base: CierreLocucion = {
      locutionId: UUID_A,
      sessionId: 'sesion-guard',
      turnId: 'turno-guard',
      inicio: 0,
      fin: SAMPLE_RATE,
      sampleRate: SAMPLE_RATE,
      texto: 'hola',
      idioma: 'es',
      overlap: false,
      final: true,
      reason: 'system',
      voz: { nombre: '', nombreConfirmado: false, hablante: '', continuidad: false },
      etiquetaAnterior: null,
      semillaEtiqueta: 'Hablante 1',
      esEtiquetaAnonima: isAutoSpeakerLabel,
    }
    const commiteada = construirFila(base)
    expect(commiteada.descarte).toBeNull()
    expect(commiteada.fila).not.toBeNull()
    expect(construirFila({ ...base, texto: '' }).descarte).toBe('sinTexto')
    expect(construirFila({ ...base, fin: base.inicio }).descarte).toBe('tramoInvalido')
  })

  it('un cierre que commitea texto NO cuenta descarte (null vale solo con fila)', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr({ tramoId, texto: 'hola', final: true })
    await cortar(api, SAMPLE_RATE)
    expect(api.snapshot().filas).toHaveLength(1)
    expect(api.snapshot().descartes).toEqual([])
  })
})

describe('Caso 9 — la caja de última frase == última fila commiteada al detener', () => {
  it('stop con la caja llena: la última fila es EXACTAMENTE el texto de la caja', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr({ tramoId, texto: 'hola mundo', final: false })
    expect(api.snapshot().box.texto).toBe('hola mundo')

    const detenida = await api.stop('user')
    const filas = detenida.filas
    expect(filas.at(-1)?.texto).toBe('hola mundo')
  })

  it('stop con texto ajeno retenido: la caja Y el pendiente se commitean, nada se pierde', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoUno = await abrirConVoz(api)
    await api.ingestAsr({ tramoId: tramoUno, texto: 'uno', final: false })
    await api.ingestAsr({
      tramoId: UUID_B,
      texto: 'dos',
      final: true,
      tramo: { inicio: SAMPLE_RATE, fin: SAMPLE_RATE * 2, sampleRate: SAMPLE_RATE },
    })
    expect(api.snapshot().box.texto).toBe('uno')

    const detenida = await api.stop('system')
    expect(detenida.filas.map((fila) => fila.texto)).toEqual(['uno', 'dos'])
    expect(detenida.descartes).toEqual([])
  })
})

describe('Caso 9 — los dueños viven en el archivo real', () => {
  it('los TRES emits de locution.closed llevan motivo y causa (cierre.ts)', () => {
    expect(cierreSiempreMotivoYCausa(fuenteDe('src/voice/conversation/cierre.ts'))).toBe(true)
  })

  it('descarte:null aparece SOLO junto a una fila, nunca junto a fila:null (fila.ts)', () => {
    expect(descarteNullSoloConFilaCommiteada(fuenteDe('src/voice/conversation/fila.ts'))).toBe(true)
  })

  it('los motivos del descarte viven tipados y no nulables (tipos.ts)', () => {
    expect(motivosDeDescarteTipados(fuenteDe('src/voice/conversation/tipos.ts'))).toBe(true)
  })

  it('el descarte se registra con su motivo, nunca silencioso (sesion.ts)', () => {
    expect(descarteRegistradoConMotivo(fuenteDe('src/voice/conversation/sesion.ts'))).toBe(true)
  })
})

describe('Caso 9 — PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('un emit de locution.closed sin causa => rojo; tres con motivo y causa => verde', () => {
    const emite = "emitir({\n  tipo: 'locution.closed',\n  sessionId,\n  tramo,\n  motivo,\n  causa,\n  medida,\n})"
    expect(cierreSiempreMotivoYCausa(emite.repeat(3))).toBe(true)
    const sinCausa = emite.replace('\n  causa,', '')
    expect(cierreSiempreMotivoYCausa(sinCausa + emite.repeat(2))).toBe(false)
    expect(cierreSiempreMotivoYCausa(emite.repeat(2))).toBe(false)
  })

  it('un descarte:null junto a fila:null => rojo; junto a la fila o ausente => verde/rojo', () => {
    const sano = 'return { fila: { locutionId }, descarte: null }'
    expect(descarteNullSoloConFilaCommiteada(sano)).toBe(true)
    const conDescarteNulo = sano + '\nreturn { fila: null, descarte: null }'
    expect(descarteNullSoloConFilaCommiteada(conDescarteNulo)).toBe(false)
    expect(descarteNullSoloConFilaCommiteada(sano.replace('descarte: null', "descarte: 'sinTexto'"))).toBe(false)
  })

  it('una union sin eco o un campo nulable => rojo; con los 4 y no nulable => verde', () => {
    const union = [
      "export type MotivoDescarteConversacion =",
      "  | 'tramoInvalido'",
      "  | 'sinTexto'",
      "  | 'eco'",
      "  | 'huerfano'",
      '',
      'type DescarteConversacion = Readonly<{',
      '  motivo: MotivoDescarteConversacion',
      '}>',
    ].join('\n')
    expect(motivosDeDescarteTipados(union)).toBe(true)
    expect(motivosDeDescarteTipados(union.replace("  | 'eco'\n", ''))).toBe(false)
    expect(motivosDeDescarteTipados(union.replace('motivo: MotivoDescarteConversacion', 'motivo: MotivoDescarteConversacion | null'))).toBe(false)
  })

  it('un descarte registrado sin motivo => rojo; con el motivo => verde', () => {
    const conMotivo = "registro.registrar('conversacion.descarte', {\n  sessionId,\n  locutionId,\n  motivo,\n  tramo,\n})"
    expect(descarteRegistradoConMotivo(conMotivo)).toBe(true)
    const sinMotivo = conMotivo.replace('\n  motivo,', '')
    expect(descarteRegistradoConMotivo(sinMotivo)).toBe(false)
  })
})
