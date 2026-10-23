// ============================================================
// vozSrGapCierreGuard - el aviso de cierre por SILENCIO tiene que EMPUJARSE.
// ------------------------------------------------------------
// REGRESION MEDIDA (2026-10-11, commit del "cierre con UN dueno"): al quitar el umbral de
// palabras quedo el `if` del srGap con el cuerpo VACIO -> el evento NUNCA se empujaba, el
// turno no cerraba jamas y el buffer de audio se saturaba a los 30 s (medido en el log:
// `MicPcm total=1440128` CLAVADO 16 s y "se volvio a congelar"). El cierre por silencio tiene
// UN dueno (evaluateSrGapSegmentCommit) y el watchdog solo EMPUJA el aviso.
// PRUEBA DE DETECTOR: el texto con el `if` vacio se marca infractor.
// ============================================================
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const HOOK = readFileSync('src/voice/hooks/useFluVoiceAssistant.js', 'utf8')

/** true si el srGap EMPUJA el aviso (else el silencio no cierra ningun turno). */
export function srGapEmpujaElAviso(src: string): boolean {
  return /if \(srGap\.fire[\s\S]{0,80}\)\s*\{[\s\S]{0,400}pushSrGapEvent/.test(src)
}

describe('cierre por silencio: el aviso se empuja (o el turno no cierra nunca)', () => {
  it('el watchdog EMPUJA el srGap (si no, el turno queda abierto y el audio se satura)', () => {
    expect(srGapEmpujaElAviso(HOOK), 'el aviso del cierre no puede quedar sin empujar').toBe(true)
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): el if VACIO se marca infractor', () => {
    const vacio = 'if (srGap.fire && !srGapFiredForOpenLineRef.current) {\n}\nreturn'
    expect(srGapEmpujaElAviso(vacio), 'el if vacio es el defecto medido').toBe(false)
    expect(srGapEmpujaElAviso(HOOK)).toBe(true)
  })
})
