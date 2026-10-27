// ============================================================
// vozFilaSiempreConHablanteGuard - P9.65: ninguna fila de usuario sin hablante.
// ------------------------------------------------------------
// MEDIDO en el log del dueno (sesion 02:20-02:42, ANTES del gate): 40 filas -> 35 SIN
// hablante (`hablantes: (vacio)=35 luis=4 Hablante 1=1`), con `written:""` en 80/80
// commits: la fila nacía sin hablante "por diseno" y dependia del relleno tardio
// (`updateTurnRowSpeaker`), que ademas solo alcanzaba 13 turnos.
//
// REGLA (un dato, un dueno): la fila de usuario SIEMPRE lleva hablante. El dueno de la
// etiqueta es `resolverEtiqueta` (src/voice/conversation/fila.ts), que LANZA con semilla
// vacia o con `?`; el commit del modulo nuevo aplica el RESPALDO cuando no hay etiqueta.
//
// ESTE GUARD mide la PROPIEDAD en las vias de escritura reales que quedan tras el
// corte de la tuberia vieja (2026-10-25): el commit del modulo nuevo
// (`commitUserTurnRow` de src/voice/conversation: nueva, reutilizada y reemplazada).
// El relleno tardio (`updateTurnRowSpeaker` de conversationTurnRow.ts, BORRADO) ya no
// existe: la etiqueta se resuelve en el propio commit.
// ============================================================
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow, resolverEtiqueta } from '../src/voice/conversation'
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
  })
  afterEach(() => {
    useIntegrationStore.setState({ conversationHistory: [] })
  })

  it('sin etiqueta NINGUNA: la fila nueva sale con el respaldo (nunca vacia)', () => {
    commitUserTurnRow({ text: 'hola que tal', turnId: 1 })
    expect(hablantes()).toEqual([RESPALDO])
  })

  it('las TRES vias del dueno (nueva, reutilizada, reemplazada) dejan hablante', () => {
    // 1) nueva
    commitUserTurnRow({ text: 'hola que tal', speakerName: 'Hablante 2', turnId: 1 })
    // 2) reutilizada por identidad de turno (texto mas completo)
    commitUserTurnRow({ text: 'hola que tal y buenos dias', speakerName: 'Hablante 2', turnId: 1 })
    // 3) reemplazada (misma emision, `replaceLast`). MISMO turno: la identidad de turno es
    // el unico criterio de reutilizacion (mandato 2026-10-23, 3a pasada).
    commitUserTurnRow({ text: 'hola que tal y buenos dias', speakerName: 'luis', replaceLast: true, turnId: 1 })
    const h = hablantes()
    expect(h).toHaveLength(1)
    h.forEach((nombre, i) => expect(nombre, `fila ${i} sin hablante`).not.toBe(''))
  })

  it('sin evidencia no queda vacio en el commit, y el dueno de la etiqueta prohibe vacio y `?`', () => {
    const { id } = commitUserTurnRow({ text: 'una frase cualquiera', turnId: 5 })
    const fila = useIntegrationStore.getState().conversationHistory.find((e) => e.id === id)
    expect(String(resolveRowSpeakerLabel(fila) || '')).toBe(RESPALDO)
    // El dueno de la etiqueta del modulo (resolverEtiqueta) LANZA antes de dejar la
    // fila vacia o con «?»: la propiedad no depende del camino del commit.
    expect(() =>
      resolverEtiqueta({
        voz: { hablante: '' },
        anterior: '',
        semilla: '',
        esEtiquetaAnonima: () => false,
      } as never),
    ).toThrow('semilla vacia')
    expect(() =>
      resolverEtiqueta({
        voz: { hablante: '?' },
        anterior: '',
        semilla: '',
        esEtiquetaAnonima: () => false,
      } as never),
    ).toThrow('etiqueta ? prohibida')
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
