// BARRERA: despacho-unico
/**
 * conversacionDespachoUnicoDuenoGuard — el dedupe del despacho tiene UN dueño.
 *
 * El planificador `planConversationDispatch` (audioMath.js) decide SOLO qué
 * frase canónica se despacha: compara firma y ventana de revisión. El cableado
 * (`compose/conversationMotorProducto`) NO filtra repeticiones: entrega cada
 * frase vigente y el plan decide. El filtro `ultimaDespachada` que vivía en el
 * cableado era una ruta doble del dedupe: dos criterios distintos sobre el
 * mismo texto, y al divergir (una ruta sí, otra no) el despacho se duplicaba o
 * se perdía.
 *
 * Mide el compositor REAL con la frontera del módulo sustituida (su contrato
 * vive en `tests/conversacionApi.test.ts`): la MISMA frase vigente entregada
 * DOS veces sale DOS veces — el cableado es un pasatuto, no un dedupero.
 * FALSIFICACIÓN: un `if (frase === ultimaDespachada)` re-introducido se marca.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  onFraseCanonica: vi.fn(),
  hook: { actual: null as null | { evento: (evento: unknown) => Promise<unknown> } },
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
    instantanea: () => ({ fraseCanonica: 'hola, ¿qué tal?' }),
    suscribir: () => () => {},
    registrarNombre: vi.fn(),
  }),
  grabarRevisionDeFila: vi.fn(),
  traeFinal: () => true,
}))

import { crearMotorConversacionHook } from '../src/voice/compose/conversationMotorProducto.js'

/** Evento del ASR de la misma frase vigente (final de tramo). */
function eventoAsr(): unknown {
  return { tramoId: 'T1', texto: 'hola, ¿qué tal?', final: true }
}

beforeEach(() => {
  hoisted.onFraseCanonica.mockClear()
  hoisted.hook.actual = crearMotorConversacionHook({
    idioma: 'es',
    onLiveTranscript: vi.fn(),
    onFraseCanonica: hoisted.onFraseCanonica,
  })
})

describe('despacho de la frase — un solo dueño (el planificador)', () => {
  it('la misma frase vigente se entrega DOS veces: el cableado NO deduplica', async () => {
    await hoisted.hook.actual!.evento(eventoAsr())
    await hoisted.hook.actual!.evento(eventoAsr())
    expect(hoisted.onFraseCanonica).toHaveBeenCalledTimes(2)
    expect(hoisted.onFraseCanonica).toHaveBeenNthCalledWith(1, 'hola, ¿qué tal?', {
      interim: false,
    })
    expect(hoisted.onFraseCanonica).toHaveBeenNthCalledWith(2, 'hola, ¿qué tal?', {
      interim: false,
    })
  })

  it('el cableado no guarda estado de dedupe: no existe `ultimaDespachada`', () => {
    const COMPOSE = readFileSync(
      join(process.cwd(), 'src/voice/compose/conversationMotorProducto.js'),
      'utf8',
    )
    expect(COMPOSE).not.toMatch(/ultimaDespachada/)
  })

  it('el planificador del despacho vive en audioMath y decide por firma y ventana', () => {
    const AUDIO_MATH = readFileSync(
      join(process.cwd(), 'src/voice/lib/audioMath.js'),
      'utf8',
    )
    expect(AUDIO_MATH).toContain('function planConversationDispatch')
    expect(AUDIO_MATH).toContain('lastSignature === signature')
    expect(AUDIO_MATH).toContain('isAsrRevision')
  })

  it('FALSIFICACIÓN: un dedupe por texto re-introducido en el cableado se marca', () => {
    const COMPOSE = readFileSync(
      join(process.cwd(), 'src/voice/compose/conversationMotorProducto.js'),
      'utf8',
    )
    const conDedupe = COMPOSE + "\n  if (frase === ultimaDespachada) return"
    expect(conDedupe).toMatch(/frase\s*===\s*ultimaDespachada/)
    expect(COMPOSE).not.toMatch(/frase\s*===\s*ultimaDespachada/)
  })
})
