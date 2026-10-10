// ============================================================
// vozFlagHuerfanoGuard - A2: una bandera de configuracion o TIENE CONSUMIDOR o NO EXISTE
// ------------------------------------------------------------
// MEDIDO (2026-10-10, `git grep -n renameSessionAutoLabelsOnRegister`): la bandera
// `voiceIdentity.capture.roomCapture.renameSessionAutoLabelsOnRegister` (fluConfig.js)
// no la leia NADIE en src/: el renombrado de etiquetas automaticas al registrar un
// nombre es incondicional y lo hace el dueno unico del registro
// (`registerSpeakerIdentity`, A1). Una bandera que nadie consulta es una promesa
// falsa: dice que se puede apagar algo que no se apaga.
//
// Criterio: la bandera se BORRA (no se consume: no hay nada que conmutar).
// ============================================================
import { describe, expect, it } from 'vitest'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

/** Bandera muerta retirada en A2. */
export const FLAG_MUERTA = 'renameSessionAutoLabelsOnRegister'

/** true si la config sigue declarando la bandera muerta. */
export function tieneFlagMuerto(cfg: any): boolean {
  const room = cfg?.voiceIdentity?.capture?.roomCapture || {}
  return Object.prototype.hasOwnProperty.call(room, FLAG_MUERTA)
}

describe('A2 - la bandera sin consumidor no existe', () => {
  it('roomCapture ya no declara renameSessionAutoLabelsOnRegister', () => {
    expect(tieneFlagMuerto(FLU_CONFIG)).toBe(false)
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): con la bandera, la marca sale', () => {
    expect(
      tieneFlagMuerto({
        voiceIdentity: { capture: { roomCapture: { [FLAG_MUERTA]: true } } },
      }),
    ).toBe(true)
    expect(tieneFlagMuerto({ voiceIdentity: { capture: { roomCapture: {} } } })).toBe(false)
    expect(tieneFlagMuerto({})).toBe(false)
  })
})
