/**
 * voiceQueryParity — Invariante §9.5/§9.6: la query a la IA y la barra de
 * búsqueda derivan de la MISMA frase canónica (transcripción), solo sin la
 * wake word y conservando el texto (acentos/mayúsculas) tal como se muestra.
 *
 * Nace ROJO (§10.2): hoy `splitTranscriptAtWakeWord` normaliza y pierde acentos,
 * y `peelWakeQuestionEcho` pasa la pregunta a minúsculas → la query a Gemini no
 * coincide con la transcripción visible.
 */
import { describe, expect, it } from 'vitest'
import {
  resolveFinalConversationAction,
  splitTranscriptAtWakeWord,
  stripWakeWordForDisplay,
} from '../src/voice/lib/audioMath'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig'

const voiceCommands = FLU_CONFIG.voiceCommands
const wakeWords: string[] = voiceCommands.wakeWords || []

const PHRASE = 'ok flu cuéntame sobre la capital de Francia'
const EXPECTED = 'cuéntame sobre la capital de Francia'

describe('voiceQueryParity — query y display = transcripción sin wake word (§9.5/§9.6)', () => {
  it('el split conserva acentos y mayúsculas tras la wake word', () => {
    const split = splitTranscriptAtWakeWord(PHRASE, wakeWords)
    expect(split.wakeWordMatched).toBe(true)
    expect(split.afterWakeText).toBe(EXPECTED)
  })

  it('stripWakeWordForDisplay conserva el texto original', () => {
    expect(stripWakeWordForDisplay(PHRASE, wakeWords)).toBe(EXPECTED)
  })

  it('la query a la IA es la frase canónica sin wake word, sin perder texto', () => {
    const action: any = resolveFinalConversationAction(PHRASE, voiceCommands)
    expect(action.kind).toBe('flu')
    expect(action.question).toBe(EXPECTED)
  })
})
