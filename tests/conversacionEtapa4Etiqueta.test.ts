// @vitest-environment node
/**
 * ETAPA 4 · HABLANTES / DIARIZACIÓN.
 *
 * Criterios de la etapa, cada uno con su caso:
 *  1. la MEDIDA es la del tramo (ventana con voz): un solo dueño de "dónde hay voz";
 *  2. IDENTIDAD solo con evidencia (medida + confirmación), nunca por parecido;
 *  3. CONTINUIDAD sin `?` en fila cerrada;
 *  4. UN SOLO ESCRITOR de la etiqueta.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow'
import { pendingSpeakerLabel } from '../src/voice/lib/speakerLabels'

const PENDIENTE = pendingSpeakerLabel()
const ROOT = process.cwd()
const leer = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
/** Sin comentarios: un guard mide IMPLEMENTACION, no menciones en prosa. */
const codigo = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const filas = () => useIntegrationStore.getState().conversationHistory

beforeEach(() => {
  useIntegrationStore.setState({ conversationHistory: [], conversationEpoch: 0 } as never)
})

describe('ETAPA 4 · etiqueta de la fila', () => {
  it('CONTINUIDAD: una fila sin medida nunca queda en "?"', () => {
    const { id } = commitUserTurnRow({ text: 'primera locucion', turnId: 1, speakerName: PENDIENTE })
    const fila = filas().find((f) => f.id === id)
    expect(String(fila?.speakerName || '')).not.toBe(PENDIENTE)
    expect(String(fila?.speakerName || '').trim()).not.toBe('')
  })

  it('IDENTIDAD: con evidencia manda la etiqueta resuelta, no la continuidad anterior', () => {
    // La sesion venia etiquetando "Hablante 2"...
    useIntegrationStore.setState({ conversationHistory: [], conversationEpoch: 0 } as never)
    commitUserTurnRow({ text: 'voz anterior', turnId: 1, speakerName: 'Hablante 2' })
    // ...y este turno llega CON evidencia acustica y su etiqueta medida.
    const { id } = commitUserTurnRow({
      text: 'voz medida',
      turnId: 2,
      speakerName: 'Hablante 1',
      evidenciaAcustica: true,
      signature: [0.1, 0.2, 0.3],
    })
    expect(String(filas().find((f) => f.id === id)?.speakerName || '')).toBe('Hablante 1')
  })

  it('G U A R D (fuente): UN SOLO escritor de la etiqueta', () => {
    const texto = codigo(leer('src/voice/lib/conversationTurnRow.ts'))
    const escrituras = texto.match(/setEntrySpeakerName\(/g) || []
    expect(escrituras, 'toda etiqueta se escribe por escribirEtiquetaDeFila').toHaveLength(1)
    expect(texto).toContain('function escribirEtiquetaDeFila(')
  })

  it('G U A R D (fuente): la MEDIDA se calcula sobre la ventana con voz, igual que el tramo', () => {
    const hook = codigo(leer('src/voice/hooks/useFluVoiceAssistant.js'))
    // La firma del turno se embebe sobre `selectVoicedWindow(audioSnapshot)` (tramo con voz).
    expect(hook).toMatch(/selectVoicedWindow\(audioSnapshot/)
    // El tramo de la fila usa el MISMO dueno (`ventanaConVoz`), no un criterio propio.
    expect(codigo(leer('src/voice/core/tramo.js'))).toContain('ventanaConVoz')
  })
})
