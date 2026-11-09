/**
 * bautizoVozIdempotenteGuard — UN bautizo de voz por locución.
 *
 * El cableado del motor (`compose/conversationMotorProducto`, en `row.committed`) es
 * el ÚNICO disparador de `motor.registrarNombre` (caso declarado en
 * `scripts/rutas-dobles-baseline.json`). Aquí se mide la otra mitad: `row.committed`
 * se REPITE al promover la fila (`revision > 1`), y el bautizo solo puede dispararse
 * con una locución NUEVA (`esNuevaLocucion`, el mismo predicado que la frontera de
 * turno). El disparo de más no es cosmético: llega con la etiqueta ya renombrada, no
 * casa el WHERE y deja un `nombrePendiente` que se aplica a la voz de la locución
 * SIGUIENTE (`motor.registrarNombre` sin voz medida + cierre de la locución).
 *
 * Mide el compositor REAL; el módulo se sustituye por su frontera (su contrato
 * vive en `tests/conversacionApi.test.ts`). El nombre se resuelve con el detector
 * real sobre texto real: «ok flu soy Luis» -> 'Luis'.
 */
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    expect(hoisted.registrarNombre).toHaveBeenCalledWith('Luis', 'Hablante 1')
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
})
