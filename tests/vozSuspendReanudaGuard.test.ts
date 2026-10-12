// ============================================================
// vozSuspendReanudaGuard — (a) el suspend NO deja la escucha colgada con la conversacion
// activa, y (b) el turno ABIERTO se suelta con la ventana del watchdog que ya existe.
// ------------------------------------------------------------
// (a) MEDIDO por el dueno (2026-10-11 00:32:50 / 00:32:59 / 00:33:20):
//     "[REC] suspend: sin reanudar en suspend (wasListeningBefore:true, conversationActive:true)"
//     x3 y `MicPcm total` CLAVADO durante minutos -> la escucha quedo suspendida para siempre y
//     dejo de transcribir. La reanudacion estaba delegada en App (onContractResolved), y un
//     turno que no cierra o un comando NO lo disparan.
// (b) El id del turno se acuna UNA vez (`openPreviewTurnRef`) y solo se suelta al cerrar: si el
//     cierre no llega, el turno se clava y el preflight se repite para el MISMO turn.
// PRUEBA DE DETECTOR: se alimenta el texto VIEJO del suspend y el detalle del turno y el
// detector DEBE marcarlo infractor.
// ============================================================
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const HOOK = readFileSync('src/voice/hooks/useFluVoiceAssistant.js', 'utf8')
const POLICY = readFileSync('src/voice/lib/voiceStallPolicy.js', 'utf8')

/** (a) El suspend reanuda si la conversacion sigue activa (una sola via, la del que suspende). */
export function suspendReanudaConConversacionActiva(src: string): boolean {
  return /waitForSpeechIdle\(\)\.then\(\(\) => \{[\s\S]{0,120}requestRestart\?\.\(0\)/.test(src)
}

/** (b) El turno abierto se suelta con la ventana del watchdog EXISTENTE. */
export function turnoSeSueltaConWatchdog(src: string): boolean {
  return /openPreviewTurnRef\.current = false[\s\S]{0,200}stallMs|stallMs[\s\S]{0,200}openPreviewTurnRef\.current = false/.test(src)
}

describe('(a)(b) suspend/turno: el defecto medido no puede volver', () => {
  it('(a) con la conversacion activa el suspend REANUDA (no deja la escucha colgada)', () => {
    expect(suspendReanudaConConversacionActiva(POLICY), 'la reanudacion la programa el que suspende (dueno unico)').toBe(true)
    expect(HOOK, 'el hook solo lo llama').toContain('resumeAfterSpeechSuspend(')
    expect(POLICY, 'el log viejo del caso activo no puede quedar').not.toContain('sin reanudar en suspend (conversación activa')
  })

  it('(b) el turno abierto se suelta con la ventana del watchdog existente', () => {
    expect(turnoSeSueltaConWatchdog(POLICY), 'sin ventana nueva: la del watchdog').toBe(true)
    expect(POLICY, 'y se declara en el log').toContain('[TURNO] flag soltado por watchdog')
    expect(HOOK, 'el hook solo lo llama').toContain('releaseStalledTurn(')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): el texto VIEJO del suspend se marca infractor', () => {
    const viejo = `if (wasListeningBefore && !conversationActiveRef?.current) { requestRecognitionRestart(0) } else {
      relayLog('LOG', 'useFluVoiceAssistant', '[REC] suspend: sin reanudar en suspend (conversación activa o no escuchaba)')
    }`
    expect(suspendReanudaConConversacionActiva(viejo), 'el codigo viejo NO reanudaba').toBe(false)
    expect(turnoSeSueltaConWatchdog('openPreviewTurnRef.current = false'), 'sin la ventana del watchdog').toBe(false)
  })
})
