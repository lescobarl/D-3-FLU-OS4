// ============================================================
// vozHablanteFilaUnicaGuard - GUARD de dos defectos MEDIDOS en el log del dueno
// (2026-10-07 17:28-17:33 UTC)
// ------------------------------------------------------------
// (1) "me puso primero como hablante uno luego como hablante dos y ahora puso
//     hablarte cuatro" / "en el hablante uno puso a la mujer".
//     CAUSA: los ticks CONTINUOS del pipeline de identidad resolvian sobre
//     ventanas parciales y su `onResolved` COMPLETABA (reescribia) la fila del
//     turno: cada tick la dejaba con la etiqueta que le salia (H1, H2, H4...).
//     FIX: el aviso que completa la fila lo da SOLO el snapshot FINAL (el unico
//     que escribe clusters y es la respuesta DEFINITIVA del turno).
//
// (2) FLU dijo "Registrado {name}." LITERAL.
//     CAUSA: `getCommandSpeech` YA interpola `{name}` con `params.name`, pero los
//     dos caminos del hook lo llamaban SIN params. FIX: se pasa el nombre
//     detectado en el propio enunciado.
//
// Nace ROJO (los ticks escribian la fila y el literal quedaba sin interpolar).
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest'
import { scheduleTurnSpeakerPreflight, resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight.js'
import { enqueueSpeakerIdentityJob } from '../src/voice/lib/voiceIdentityQueue.js'
import { getCommandSpeech } from '../src/voice/lib/voiceCommands.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { COMMAND_IDS } from '../src/voice/lib/commandIds.js'

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

const resolver = () => () =>
  Promise.resolve({
    speakerId: 'spk-1',
    speakerName: 'Hablante 1',
    signatureVector: [1, 0, 0],
    workingClusters: [{ label: 'Hablante 1', signature: [1, 0, 0] }],
    reason: 'resolved-idle',
  })

describe('la fila del turno la completa SOLO el snapshot FINAL', () => {
  beforeEach(() => {
    resetTurnSpeakerPreflights()
  })

  it('un tick CONTINUO no avisa al dueno de la fila', async () => {
    const onResolved = () => {}
    let called = 0
    scheduleTurnSpeakerPreflight(7, resolver(), {
      continuous: true,
      onResolved: () => {
        called += 1
      },
    })
    await flush()
    expect(called, 'un tick parcial NO puede reescribir la fila').toBe(0)
    void onResolved
  })

  it('el snapshot FINAL si avisa (una vez)', async () => {
    let called = 0
    scheduleTurnSpeakerPreflight(8, resolver(), {
      continuous: false,
      onResolved: () => {
        called += 1
      },
    })
    await flush()
    expect(called).toBe(1)
  })
})

describe('el speech de un comando no deja placeholders', () => {
  it('REGISTRAR_PARTICIPANTE con nombre interpola {name}', () => {
    expect(getCommandSpeech(COMMAND_IDS.REGISTRAR_PARTICIPANTE, 'es', FLU_CONFIG, { name: 'Luis' })).toBe(
      'Registrado Luis.',
    )
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('sin params el placeholder sigue ahi (por eso el hook DEBE pasar el nombre)', () => {
    expect(getCommandSpeech(COMMAND_IDS.REGISTRAR_PARTICIPANTE, 'es', FLU_CONFIG)).toContain('{name}')
  })

  it('la cola de identidad queda limpia entre casos', async () => {
    const fired: string[] = []
    enqueueSpeakerIdentityJob({
      rowId: 'x',
      run: () => Promise.resolve({ ok: true }),
      onSuccess: () => fired.push('s'),
    })
    await flush()
    expect(fired).toEqual(['s'])
  })
})
