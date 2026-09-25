/**
 * INV-7 (§9.7) — prueba FUNCIONAL de lo visible (complementa el guard G1–G7).
 *
 * Invariante: una frase hablada produce UNA sola fila canónica y la MISMA
 * frase (sin wake word) es la que se envía a la IA y la que muestran las vistas.
 *
 *   fila (bitácora/burbuja) = capture limpio
 *   query (IA)              = fila sin wake word
 *   display (burbuja/barra) = la MISMA fila
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig'
import { cleanForSpeech, normalizeVoiceCommandText } from '../src/voice/lib/audioMath'
import { analyzeWakeTurn } from '../src/voice/lib/wakeTurnCommit'
import { resolveLogRowAction } from '../src/voice/lib/conversationStream'
import { deriveUserRowTexts, selectVisiblePhrase } from '../src/voice/lib/conversationDialogue'
import { useIntegrationStore } from '../src/store/integrationStore'

const wakeWords: string[] = FLU_CONFIG.voiceCommands?.wakeWords || []

describe('voiceCanonicalPhrase — una frase → una fila + misma query (§9.7)', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory()
  })

  it('la query a la IA es la fila canónica sin wake, y el display devuelve esa misma fila', () => {
    const capture = 'Okay flu Platícame de la nave que fue a la luna artemis 2'
    const turn = analyzeWakeTurn(capture, { wakeWords })
    const row = turn.cleaned
    const query = turn.question

    expect(row).toBeTruthy()
    expect(query).toBeTruthy()
    // La query es la MISMA fila sin la wake word (el wake va al inicio).
    // Se compara en forma normalizada (casing/acentos/puntuación).
    expect(normalizeVoiceCommandText(row).endsWith(normalizeVoiceCommandText(query))).toBe(true)
    expect(row.length).toBeGreaterThan(query.length)
    // El display devuelve la MISMA cadena que la fila.
    expect(selectVisiblePhrase({ lastTranscript: row })).toBe(cleanForSpeech(row))
    // La derivación de filas devuelve la MISMA cadena.
    expect(deriveUserRowTexts([{ role: 'user', text: row }] as any)).toEqual([cleanForSpeech(row)])
  })

  it('una misma emisión no agrega fila: el motor decide reemplazar', () => {
    const v1 = 'Okay flu Platícame de los aviones'
    const repite = resolveLogRowAction({
      turnCommit: true,
      lastEmitted: v1,
      lastCommitted: v1,
      capture: v1,
    })
    expect(repite.replaceLast).toBe(true)

    const otra = 'Okay flu Cuéntame un chiste'
    const nueva = resolveLogRowAction({
      turnCommit: true,
      lastEmitted: v1,
      lastCommitted: v1,
      capture: otra,
    })
    expect(nueva.replaceLast).toBe(false)
  })

  it('una frase hablada deja UNA sola fila de usuario en el store, coherente con la query', () => {
    const capture = 'Okay flu Platícame de los aviones'
    const turn = analyzeWakeTurn(capture, { wakeWords })

    useIntegrationStore.getState().addConversationEntry({
      id: 'inv7-row',
      role: 'user',
      text: turn.cleaned,
      timestamp: Date.now(),
    } as any)

    const rows = useIntegrationStore.getState().conversationHistory.filter((e) => e.role === 'user')
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe(cleanForSpeech(turn.cleaned))
    expect(normalizeVoiceCommandText(rows[0].text).endsWith(normalizeVoiceCommandText(turn.question))).toBe(true)
  })
})
