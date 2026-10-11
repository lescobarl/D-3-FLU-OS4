// ============================================================
// vozPrimarioReinicioGuard - A4: el hablante primario (el nombre presentado por voz)
// SOBREVIVE al reinicio de escucha; solo se limpia al CERRAR la sesion.
// ------------------------------------------------------------
// DEFECTO MEDIDO (2026-10-10): `navigation.sessionResetCommand` es INICIAR_CONVERSACION y
// su lista de frases mezcla abrir ("iniciar conversacion") con cerrar/reiniciar ("nueva
// sesion"). El hook limpiaba el primario en esa rama SIEMPRE: abrir o reanudar la escucha
// borraba el nombre presentado ("soy Luz") y los turnos siguientes volvian a "Hablante N".
//
// DUENO UNICO: `isSessionCloseRequest` + `applySessionCommandToPrimary`
// (src/voice/lib/sessionLifecycle.js), con las frases de cierre en config.
//
// NACE ROJO: el dueno no existia (el modulo no cargaba).
// ============================================================
import { describe, expect, it } from 'vitest'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import {
  applySessionCommandToPrimary,
  isSessionCloseRequest,
} from '../src/voice/lib/sessionLifecycle.js'
import { resolveConversationSpeaker } from '../src/voice/lib/voiceIdentity.js'

const vozA = Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.1))

describe('A4 - el primario sobrevive al reinicio de escucha', () => {
  it('ABRIR/reanudar la escucha NO limpia el nombre presentado', () => {
    const ref = { current: 'Luz' }
    for (const frase of ['iniciar conversacion', 'okay flu iniciar conversacion', 'empezar conversacion', 'start conversation']) {
      const out = applySessionCommandToPrimary({ transcript: frase, sessionPrimarySpeakerRef: ref })
      expect(out.cleared, `"${frase}" no es un cierre`).toBe(false)
      expect(ref.current, `"${frase}" borro el nombre`).toBe('Luz')
    }
  })

  it('CERRAR la sesion SI limpia el primario', () => {
    for (const frase of ['nueva sesion', 'reiniciar conversacion', 'nueva conversacion', 'new session']) {
      const ref = { current: 'Luz' }
      const out = applySessionCommandToPrimary({ transcript: frase, sessionPrimarySpeakerRef: ref })
      expect(out.cleared, `"${frase}" es un cierre`).toBe(true)
      expect(ref.current).toBe('')
    }
  })

  it('los turnos siguientes salen con el nombre (el primario conservado manda, con su ancla)', () => {
    // CORRECCION DE CRITERIO (7.7.f(3)): el nombre exige COINCIDENCIA con su ancla; el
    // primer turno la crea y va con etiqueta, el segundo ya lo afirma.
    const clusters: { label?: string; signature?: number[] }[] = []
    const primero = resolveConversationSpeaker({
      speakerClusters: clusters,
      sessionPrimary: 'Luz',
      signatureVector: vozA,
      voicedSampleCount: 48000,
      minVoicedSamples: 12000,
      sampleRate: 48000,
      utteranceText: 'siguiente carta por favor',
      atTurnBoundary: true,
      allowNewCluster: true,
    } as never)
    expect(primero, 'sin ancla no se afirma el nombre').not.toBe('Luz')
    expect(
      resolveConversationSpeaker({
        speakerClusters: clusters,
        sessionPrimary: 'Luz',
        signatureVector: vozA,
        lastSpeaker: String(primero),
        voicedSampleCount: 48000,
        minVoicedSamples: 12000,
        sampleRate: 48000,
        utteranceText: 'siguiente carta por favor',
        atTurnBoundary: true,
        allowNewCluster: true,
      } as never),
    ).toBe('Luz')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): el criterio es la lista de config', () => {
    // Config invertida: la apertura se declara cierre y viceversa -> la marca se da la vuelta.
    const invertida = {
      voiceCommands: { sessionClosePhrases: ['iniciar conversacion'] },
    }
    expect(isSessionCloseRequest('iniciar conversacion', invertida)).toBe(true)
    expect(isSessionCloseRequest('nueva sesion', invertida)).toBe(false)
    // Y con la config real, lo contrario.
    expect(isSessionCloseRequest('iniciar conversacion', FLU_CONFIG)).toBe(false)
    expect(isSessionCloseRequest('nueva sesion', FLU_CONFIG)).toBe(true)
    expect((FLU_CONFIG as never as { voiceCommands: { sessionClosePhrases: string[] } }).voiceCommands.sessionClosePhrases.length).toBeGreaterThan(0)
  })
})
