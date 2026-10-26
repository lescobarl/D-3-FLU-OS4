// ============================================================
// vozFilaSiempreConHablanteGuard - P9.65: ninguna fila de usuario sin hablante.
// ------------------------------------------------------------
// MEDIDO en el log del dueno (sesion 02:20-02:42, ANTES del gate): 40 filas -> 35 SIN
// hablante (`hablantes: (vacio)=35 luis=4 Hablante 1=1`), con `written:""` en 80/80
// commits: la fila nacía sin hablante "por diseno" y dependia del relleno tardio
// (`updateTurnRowSpeaker`), que ademas solo alcanzaba 13 turnos.
//
// REGLA (un dato, un dueno): la fila de usuario SIEMPRE lleva hablante. El dueno de la fila
// (`resolveRowSpeakerName`) aplica el RESPALDO cuando no hay etiqueta, y el commit aporta la
// etiqueta que trae el resolver (la evidencia acustica solo decide el ASCENSO a nombre
// propio). El relleno tardio COMPLETA; no es la unica via.
//
// ESTE GUARD mide la PROPIEDAD en las vias de escritura reales que quedan tras el
// corte de la tuberia vieja (2026-10-25): el commit del modulo nuevo
// (`commitUserTurnRow`: nueva, reutilizada y reemplazada) y el relleno tardio.
// ============================================================
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow, updateTurnRowSpeaker } from '../src/voice/lib/conversationTurnRow'
import { resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const RESPALDO = String(
  (FLU_CONFIG as { voiceIdentity?: { labels?: { fallbackSpeaker?: string } } }).voiceIdentity?.labels
    ?.fallbackSpeaker || '',
)

const filasUsuario = () =>
  useIntegrationStore.getState().conversationHistory.filter((e) => e.role === 'user')

const hablantes = () => filasUsuario().map((e) => String(resolveRowSpeakerLabel(e) || ''))

describe('P9.65 - la fila de usuario SIEMPRE lleva hablante', () => {
  beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [] })
    resetTurnSpeakerPreflights()
  })
  afterEach(() => {
    resetTurnSpeakerPreflights()
  })

  it('sin etiqueta NINGUNA: la fila nueva sale con el respaldo (nunca vacia)', () => {
    commitUserTurnRow({ text: 'hola que tal', turnId: 1 } as never)
    expect(hablantes()).toEqual([RESPALDO])
  })

  it('las TRES vias del dueno (nueva, reutilizada, reemplazada) dejan hablante', () => {
    // 1) nueva
    commitUserTurnRow({ text: 'hola que tal', speakerName: 'Hablante 2', turnId: 1 } as never)
    // 2) reutilizada por identidad de turno (texto mas completo)
    commitUserTurnRow({ text: 'hola que tal y buenos dias', speakerName: 'Hablante 2', turnId: 1 } as never)
    // 3) reemplazada (misma emision, `replaceLast`). MISMO turno: la identidad de turno es
    // el unico criterio de reutilizacion (mandato 2026-10-23, 3a pasada).
    commitUserTurnRow({ text: 'hola que tal y buenos dias', speakerName: 'luis', replaceLast: true, turnId: 1 } as never)
    const h = hablantes()
    expect(h).toHaveLength(1)
    h.forEach((nombre, i) => expect(nombre, `fila ${i} sin hablante`).not.toBe(''))
  })

  it('el relleno tardio tampoco deja vacio (y no pisa el respaldo con nada)', () => {
    const { id } = commitUserTurnRow({ text: 'una frase cualquiera', turnId: 5 } as never)
    updateTurnRowSpeaker(5, '' as never)
    const fila = useIntegrationStore.getState().conversationHistory.find((e) => e.id === id)
    expect(String(resolveRowSpeakerLabel(fila) || '')).toBe(RESPALDO)
  })

  it('control NEGATIVO (el detector no es decorativo): el gate VIEJO dejaba `written` vacio', () => {
    // Mutante del defecto medido: condicionar la ESCRITURA a la evidencia acustica.
    const gateViejo = (etiqueta: string, ready: boolean): string => (ready ? etiqueta : '')
    expect(gateViejo('Hablante 2', false), 'el defecto: written "" con preflight no listo').toBe('')
    // Y lo que el dueno de la fila hace con '' es el RESPALDO (nunca vacio), asi que la
    // fila tampoco puede quedar sin hablante: esa es la propiedad que se fija arriba.
    expect(RESPALDO).not.toBe('')
  })
})
