// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveVoiceCommand } from '../src/voice/lib/deterministicArbiter'
import { analyzeWakeTurn } from '../src/voice/lib/wakeTurnCommit'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig'
import { useIntegrationStore } from '../src/store/integrationStore'

const VIDEO = 'Okay Flow generame un video de un perro border collie inteligente que esté enseñando'
const INLINE = 'bien aquí va bien okay Flow Platícame de los aviones con imágenes'
const wakeWords = FLU_CONFIG.voiceCommands.wakeWords

const hookSource = () => readFileSync('src/voice/hooks/useFluVoiceAssistant.js', 'utf8')
const productSource = () => readFileSync('src/voice/compose/conversationMotorProducto.js', 'utf8')

describe('voz: un solo despacho, video por árbitro, HUD, nav y fila', () => {
  it('VIDEO: el dueño único (árbitro) resuelve el video, no el plan duplicado', () => {
    const result = resolveVoiceCommand(VIDEO, { wakeWords })
    console.log('[VIDEO arbiter]', JSON.stringify(result))
    expect(result.kind).toBe('command')
    expect(result.channel).toBe('video')
  })

  it('INTERIM: onFraseCanonica NO despacha en interino', () => {
    const hook = hookSource()
    const block = hook.slice(hook.indexOf('onFraseCanonica:'), hook.indexOf('onLocucionCommiteada:'))
    console.log('[INTERIM source]', JSON.stringify(block.slice(0, 280)))
    expect(block).toMatch(/if\s*\(\s*opciones\.interim\s*===\s*true\s*\)\s*return/)
  })

  it('SINGLE: onLocucionCommiteada NO es una segunda ruta de despacho', () => {
    const hook = hookSource()
    const block = hook.slice(
      hook.indexOf('onLocucionCommiteada:'),
      hook.indexOf('fluParticipantRef.current?.onTurnCommitted'),
    )
    console.log('[SINGLE source]', JSON.stringify(block.slice(0, 280)))
    expect(block).not.toContain('tryDispatchConversationActionRef')
  })

  it('INLINE: split y consulta se conservan', () => {
    const wake = analyzeWakeTurn(INLINE, { wakeWords })
    console.log('[INLINE analyze]', JSON.stringify({
      wake: wake.wakeWordMatched,
      inline: wake.hasInlineBoundary,
      passive: wake.passiveOnly,
      after: wake.afterWake,
      action: wake.action,
    }))
    expect(wake.hasInlineBoundary).toBe(true)
    expect(wake.afterWake).toMatch(/platicame de los aviones/i)
    expect(wake.action?.kind).toBe('flu')
  })

  it('HUD: la última respuesta de FLU es la de la IA, no Registrado Luis', () => {
    const store = useIntegrationStore.getState()
    store.setLastResponse('Registrado Luis.')
    store.addFluMessage('Los aviones son aeronaves con alas fijas.')
    const after = useIntegrationStore.getState()
    console.log('[HUD lastResponse]', JSON.stringify(after.lastResponse))
    expect(after.lastResponse).toContain('aviones')
  })

  it('NAV: la fila de nombre no pisa la última petición de información', () => {
    const product = productSource()
    console.log('[NAV source]', JSON.stringify(product.slice(product.indexOf('if (nombreDicho)'), product.indexOf('if (nombreDicho)') + 420)))
    expect(product).toContain('if (!nombreDicho) useIntegrationStore.getState().setLastCommittedTranscript')
  })

  it('FILA: la fila del comando queda escrita al cierre de la locución', () => {
    const store = useIntegrationStore.getState()
    store.addConversationEntry({
      id: 'fila-0054',
      role: 'user',
      speakerName: 'Hablante 1',
      text: VIDEO,
      timestamp: Date.parse('2026-11-11T00:54:28Z'),
    })
    const row = useIntegrationStore.getState().conversationHistory.find((e) => e.id === 'fila-0054')
    console.log('[FILA]', JSON.stringify(row))
    expect(row?.text).toBe(VIDEO)
  })
})
