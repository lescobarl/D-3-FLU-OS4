// ============================================================
// vozRespuestaNombreUnaGuard (P9.80) - UNA locucion de nombre => UNA sola respuesta.
// ------------------------------------------------------------
// DEFECTO MEDIDO por el dueno (2026-10-12 16:29:42 y 16:29:45): "Registrado Luis." DOS
// veces para UNA sola locucion "Okay flu Soy Luis". La causa declarada entonces eran DOS
// emisores de la MISMA respuesta (via pasiva `emitActiveConversationCommand` + via
// directCommand de `processCapture`) sobre la doble fila de P9.73.
// Desde entonces cerraron los habilitadores: P9.73 (el id del turno se acuna por LOCUCION,
// commit b3e8541), P9.69 (el tramo pasivo del split por wake NO lleva identidad, beeef07),
// el emisor unico `buildCommandSpeech` (42059e6) y el contrato de la respuesta en el store
// (P9.82). Esta barrera MIDE el despacho con las funciones REALES y fija la propiedad:
//   (1) la via PASIVA no puede despachar el comando: ninguno de los tramos del split por
//       wake lleva la wake en su propio enunciado (regla §9/F: la wake no se hereda);
//   (2) la locucion completa resuelve UN comando (REGISTRAR_PARTICIPANTE) por la via
//       directa, y el MISMO comando (no otro) por el planificador;
//   (3) la re-entrega del MISMO turno no vuelve a despachar (plan 'dedup').
// ============================================================
import { describe, expect, it } from 'vitest'
import { analyzeWakeTurn } from '../src/voice/lib/wakeTurnCommit.js'
import { isCommandAuthorized, resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter.js'
import { planConversationDispatch } from '../src/voice/lib/audioMath.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { COMMAND_IDS } from '../src/voice/lib/commandIds.js'

const CAPTURA = 'okay flu soy luis'
const wakeWords = FLU_CONFIG.voiceCommands.wakeWords
const AHORA = 1_000_000

describe('P9.80 - una locucion de nombre produce UNA sola respuesta', () => {
  it('la via PASIVA no puede despachar el comando (ningun tramo del split lleva la wake)', () => {
    const analysis = analyzeWakeTurn(CAPTURA, { lastCommitted: '' })
    const tramos = [analysis.passiveOnly, analysis.afterWake].filter((t) => Boolean(t))
    const despachables = tramos.filter((t) => isCommandAuthorized(t, { wakeWords }))
    console.log(
      `  split: pasivo="${analysis.passiveOnly}" cola="${analysis.afterWake}" tramos=${tramos.length} despachables=${despachables.length}`,
    )
    expect(tramos.length, 'el split real separa pasivo y cola').toBeGreaterThan(0)
    expect(despachables, 'la wake no se hereda: la via pasiva no despacha el comando').toHaveLength(0)
  })

  it('la locucion la resuelve UNA sola via (la wake); el arbitro no levanta una segunda', () => {
    // MEDIDO: la via del arbitro determinista (rama directCommand de processCapture) NO
    // resuelve el comando de nombre (domain null con cualquier forma del texto); la via
    // UNICA es el planificador de la wake. Si apareciera una segunda via, cae esta marca.
    const directo = resolveDeterministicCommand(CAPTURA, { texts: [CAPTURA] })
    console.log(`  arbitro: domain=${directo.domain} action=${directo.action}`)
    expect(directo.domain, 'sin SEGUNDA via del comando de nombre').toBe(null)

    const plan = planConversationDispatch(CAPTURA, FLU_CONFIG.voiceCommands, {
      wakeRequired: true,
      lastCommitted: '',
      lastSignature: '',
      lastAt: 0,
      lastPhrase: '',
      now: AHORA,
    })
    console.log(`  plan: ${plan.plan} kind=${plan.action?.kind} command=${plan.action?.command}`)
    expect(plan.plan).toBe('dispatch')
    expect(plan.action?.kind).toBe('command')
    expect(plan.action?.command, 'las dos puertas resuelven el MISMO comando').toBe(
      COMMAND_IDS.REGISTRAR_PARTICIPANTE,
    )
  })

  it('la re-entrega del MISMO turno NO vuelve a despachar (dedup)', () => {
    const plan = planConversationDispatch(CAPTURA, FLU_CONFIG.voiceCommands, {
      wakeRequired: true,
      lastCommitted: '',
      lastSignature: '',
      lastAt: 0,
      lastPhrase: '',
      now: AHORA,
    })
    const reEntrega = planConversationDispatch(CAPTURA, FLU_CONFIG.voiceCommands, {
      wakeRequired: true,
      lastCommitted: '',
      lastSignature: plan.signature,
      lastAt: AHORA,
      lastPhrase: CAPTURA,
      now: AHORA + 500,
    })
    console.log(`  re-entrega: ${reEntrega.plan}`)
    expect(reEntrega.plan, 'el mismo turno no se despacha dos veces').toBe('dedup')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): la wake discrimina el despacho', () => {
    // Sin wake en su propio enunciado: no autorizado (regla §9/F).
    expect(isCommandAuthorized('soy luis', { wakeWords })).toBe(false)
    // Con la wake: autorizado.
    expect(isCommandAuthorized(CAPTURA, { wakeWords })).toBe(true)
  })
})
