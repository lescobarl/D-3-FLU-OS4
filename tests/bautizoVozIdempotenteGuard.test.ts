/**
 * bautizoVozIdempotenteGuard — UN bautizo de voz por locución.
 *
 * El cableado del motor (`compose/conversationMotorProducto`, en `row.committed`) es
 * el ÚNICO disparador de `motor.registrarNombre` (caso declarado en
 * `scripts/rutas-dobles-baseline.json`). Aquí se mide la otra mitad: `row.committed`
 * se REPITE al promover la fila (`revision > 1`), y el bautizo solo puede dispararse
 * con una locución NUEVA (`esNuevaLocucion`, el mismo predicado que la frontera de
 * turno). El disparo de más no es cosmético: llega con la etiqueta ya renombrada,
 * no casa el WHERE y repite el recorrido de filas que ya hicieron el bautizo.
 *
 * Mide el compositor REAL; el módulo se sustituye por su frontera (su contrato
 * vive en `tests/conversacionApi.test.ts`). El nombre se resuelve con el detector
 * real sobre texto real: «ok flu soy Luis» -> 'Luis'.
 *
 * SEGUNDA MITAD (B2, mandato del dueño 2026-10-13): lo que el ASR CAPTURA no es el
 * nombre de la voz. «ok flu soy Luis sigue sin funcionar» captura «Luis Sigue Sin» y
 * la fila se bautizaba con esa basura mientras la base decía «Luis». La preferencia
 * por el nombre YA conocido tiene dueño único (`speakerDirectory.preferKnownVoiceName`
 * + `knownVoiceNames`); el disparador solo aporta la captura y lo que entrega al
 * bautizo es el nombre resuelto. Un segundo resolutor (una copia de la regla en otra
 * ruta) vuelve a dejar que una ruta bautice con el texto crudo: eso lo mide este
 * guard, con su falsificación.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  registrarNombre: vi.fn(),
  oyente: { actual: null as null | ((evento: unknown) => void) },
}))

vi.mock('../src/store/integrationStore', () => ({
  useIntegrationStore: {
    getState: () => ({
      activePersonId: '',
      conversationHistory: [],
      setLastCommittedTranscript: vi.fn(),
      setEntrySpeakerName: vi.fn(),
      addConversationEntry: vi.fn(),
      noteSpeakerHighWater: vi.fn(),
    }),
  },
}))

vi.mock('../src/voice/lib/sessionRecorder.js', () => ({
  getSessionRecordingStatus: () => ({ sessionId: '' }),
}))

vi.mock('../src/voice/conversation/index', () => ({
  crearMotorConversacionProducto: () => ({
    abrir: vi.fn(),
    cerrar: vi.fn(),
    evento: vi.fn(() => Promise.resolve()),
    audio: vi.fn(),
    instantanea: () => ({ fraseCanonica: '' }),
    suscribir: (oyente: (evento: unknown) => void) => {
      hoisted.oyente.actual = oyente
      return () => {}
    },
    registrarNombre: hoisted.registrarNombre,
  }),
  grabarRevisionDeFila: vi.fn(),
  traeFinal: () => true,
}))

import { crearMotorConversacionHook } from '../src/voice/compose/conversationMotorProducto.js'
import { registerVoiceName, resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js'
import { walkFiles } from './_helpers'

/** Fila commiteada del mandato «ok flu soy Luis» (etiqueta automática = WHERE). */
const FILA = {
  locutionId: 'L1',
  texto: 'ok flu soy Luis',
  etiqueta: 'Hablante 1',
  sessionId: 's1',
  turnId: 't1',
  evidencia: 'medida',
  firma: null,
  revision: 1,
  tramo: { inicio: 0, fin: 24000 },
  sampleRate: 48000,
  updated_at: '2026-11-08T10:00:00.000Z',
}

/**
 * Emite un evento del motor a la composición viva.
 * @param {object} fila Fila del evento.
 */
function commitear(fila: Record<string, unknown>): void {
  hoisted.oyente.actual?.({ tipo: 'row.committed', fila })
}

beforeEach(() => {
  hoisted.registrarNombre.mockClear()
  hoisted.oyente.actual = null
  crearMotorConversacionHook({ idioma: 'es', onLiveTranscript: vi.fn(), onFraseCanonica: vi.fn() })
})

describe('bautizo de voz — un disparo por locución', () => {
  it('«ok flu soy X» bautiza UNA vez, con el nombre dicho y la etiqueta de la fila', () => {
    commitear(FILA)
    expect(hoisted.registrarNombre).toHaveBeenCalledTimes(1)
    expect(hoisted.registrarNombre).toHaveBeenCalledWith('Luis', 'Hablante 1', 'L1')
  })

  it('la REVISIÓN de la misma fila no vuelve a bautizar (una locución, un disparo)', () => {
    commitear(FILA)
    commitear({ ...FILA, revision: 2, evidencia: 'nombre' })
    expect(hoisted.registrarNombre).toHaveBeenCalledTimes(1)
  })

  it('dos locuciones distintas con nombre bautizan dos veces', () => {
    commitear(FILA)
    commitear({ ...FILA, locutionId: 'L2' })
    expect(hoisted.registrarNombre).toHaveBeenCalledTimes(2)
  })

  it('una fila sin mandato de nombre no bautiza a nadie', () => {
    commitear({ ...FILA, texto: 'hola, ¿qué tal?' })
    expect(hoisted.registrarNombre).not.toHaveBeenCalled()
  })

  it('CONTRATO ASR LOCAL: una fila `origen: local` no bautiza (el respaldo no es accionable)', () => {
    // §8 de docs/CONTRATO-ASR-LOCAL.md: el texto del respaldo por tramo no
    // ejecuta comandos ni bautiza voces. Falsificación: sin la condición, la
    // misma fila que sí bautiza arriba lo haría también aquí.
    commitear({ ...FILA, origen: 'local' })
    expect(hoisted.registrarNombre).not.toHaveBeenCalled()
  })
})

// ============================================================
// B2 — el nombre lo resuelve el DIRECTORIO, no la captura del ASR
// ------------------------------------------------------------
// El compositor REAL se ejerce con el detector real sobre texto real y el
// directorio real (`speakerDirectory`): solo se sustituye la frontera del
// módulo (su contrato vive en `tests/conversacionApi.test.ts`).
// ============================================================
const COMPOSE = readFileSync(
  join(process.cwd(), 'src/voice/compose/conversationMotorProducto.js'),
  'utf8',
)

/** Implementación de la regla «prefiere el nombre ya conocido» (una sola). */
const REGLA_DE_PREFERENCIA = /function\s+preferKnownVoiceName\s*\(/

/**
 * Módulos que IMPLEMENTAN la regla de preferencia (no los que la invocan).
 * @param {Record<string, string>} fuentes Fuentes por ruta relativa.
 * @returns {string[]} Rutas que la implementan, ordenadas.
 */
function modulosConReglaDePreferencia(fuentes: Record<string, string>): string[] {
  return Object.entries(fuentes)
    .filter(([, texto]) => REGLA_DE_PREFERENCIA.test(String(texto)))
    .map(([ruta]) => ruta)
    .sort()
}

/** Fuentes de TODO `src`, que es el alcance real de la regla. */
function fuentesDeSrc(): Record<string, string> {
  const raiz = process.cwd()
  const fuentes: Record<string, string> = {}
  for (const abs of walkFiles(join(raiz, 'src'), /\.(js|ts|tsx)$/)) {
    fuentes[relative(raiz, abs).replace(/\\/g, '/')] = readFileSync(abs, 'utf8')
  }
  return fuentes
}

describe('bautizo de voz — el nombre lo resuelve el directorio', () => {
  afterEach(() => resetVoiceDirectory())

  it('«ok flu soy Luis sigue sin funcionar» bautiza «Luis», no la captura completa', () => {
    // La base ya conoce a Luis: su voz se llama Luis, diga lo que diga el ASR detrás.
    registerVoiceName('speaker_1', 'Luis')
    commitear({ ...FILA, texto: 'ok flu soy Luis sigue sin funcionar' })
    expect(hoisted.registrarNombre).toHaveBeenCalledTimes(1)
    expect(hoisted.registrarNombre).toHaveBeenCalledWith('Luis', 'Hablante 1', 'L1')
  })

  it('«ok flu soy Luis regís regístrame» bautiza «Luis», no «Luis Regis»', () => {
    // MEDIDO 2026-11-09 10:35 (sesión 36a8bc05): sin «Luis» en la base, el parser se tragó
    // «regís regístrame» y bautizó «Luis Regis». Las formas verbales son sufijo de
    // confirmación (`confirmationSuffix`, dueño único del vocabulario).
    commitear({ ...FILA, texto: 'okay flu soy Luis regís regístrame' })
    expect(hoisted.registrarNombre).toHaveBeenCalledWith('Luis', 'Hablante 1', 'L1')
  })

  it('«… Soy Luis vamos a revisar» bautiza «Luis», no «Luis Vamos» (19:05)', () => {
    // MEDIDO 2026-11-12 19:05 (ancla «Hablante 1»): el registro guardó «Luis
    // Vamos» porque la captura se tragó la cola del mandato tras el nombre.
    commitear({
      ...FILA,
      texto: 'este vamos a ver vamos a revisar Okay flujo Soy Luis vamos a revisar',
    })
    expect(hoisted.registrarNombre).toHaveBeenCalledWith('Luis', 'Hablante 1', 'L1')
  })

  it('una voz NUEVA que se presenta conserva su nombre (no hay conocido que preferir)', () => {
    registerVoiceName('speaker_1', 'Luis')
    commitear({ ...FILA, texto: 'ok flu soy Marta' })
    expect(hoisted.registrarNombre).toHaveBeenCalledWith('Marta', 'Hablante 1', 'L1')
  })

  it('el nombre sale con GRAFIA CANONICA aunque la base lo guarde en minusculas', () => {
    // MEDIDO en la sesion real 2026-11-08 02:27:11: la base guardaba "luis" (minuscula)
    // y el evento del bautizo salio con `{"nombre":"luis"}`.
    registerVoiceName('speaker_1', 'luis')
    commitear({ ...FILA })
    expect(hoisted.registrarNombre).toHaveBeenCalledWith('Luis', 'Hablante 1', 'L1')
  })

  it('el compositor NO entrega la captura cruda a registrarNombre', () => {
    expect(COMPOSE).toContain('preferKnownVoiceName(')
    expect(COMPOSE).toContain('knownVoiceNames()')
    expect(COMPOSE).not.toMatch(/registrarNombre\(\s*detectWakeIntroducedName/)
  })

  it('la regla de preferencia tiene UN dueño: el directorio de voces', () => {
    const fuentes = fuentesDeSrc()
    // ANTI-VACUIDAD: el escaneo ve la fuente real del dueño.
    expect(fuentes['src/voice/lib/speakerDirectory.js']).toBeTruthy()
    expect(modulosConReglaDePreferencia(fuentes)).toEqual(['src/voice/lib/speakerDirectory.js'])
  })

  it('FALSIFICACIÓN: una segunda copia de la regla en otra ruta se marca', () => {
    expect(
      modulosConReglaDePreferencia({
        'src/voice/lib/speakerDirectory.js': 'export function preferKnownVoiceName(name) {}',
        'src/voice/compose/copia.js': 'function preferKnownVoiceName(name) { return name }',
        'src/voice/lib/consumidor.js': 'const n = preferKnownVoiceName(captura, knownVoiceNames())',
      }),
    ).toEqual(['src/voice/compose/copia.js', 'src/voice/lib/speakerDirectory.js'])
  })
})
