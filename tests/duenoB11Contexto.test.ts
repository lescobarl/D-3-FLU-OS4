// ============================================================
// duenoB11Contexto - Anexo B.11: lo ANTERIOR a la wake es habla de CONTEXTO (TV/sala) o
// residuo del ASR, y NO debe registrar un nombre propio.
// ------------------------------------------------------------
// REGRESION MEDIDA (commit 64caeee): para que el registro disparara con la forma partida
// del ASR, `detectWakeIntroducedName` pasa a leer el intro ANTES de la wake con
// `mustOpen:false` -> cualquier "soy <nombre>" del contexto registra el nombre.
// NACE ROJO. El arreglo NO es volver a `mustOpen:true` a secas (rompe la forma real del
// ASR): el intro previo solo vale si el mandato tras la wake es un FRAGMENTO ("... soy").
// ============================================================
import { describe, expect, it } from 'vitest'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { detectWakeIntroducedName } from '../src/voice/lib/audioMath.js'

const WAKE = FLU_CONFIG.voiceCommands.wakeWords

describe('B11 - el contexto antes de la wake NO registra nombre', () => {
    it('"soy <nombre>" en el contexto (TV / otra persona) NO da nombre', () => {
        expect(
            detectWakeIntroducedName('ayer mi tia dijo soy Luis y ahora okay flu pon musica', WAKE),
            'contexto antepuesto + mandato real',
        ).toBe('')
        expect(
            detectWakeIntroducedName('la tv estaba diciendo soy Luis okay flu', WAKE),
            'contexto antepuesto',
        ).toBe('')
    })

    it('la forma REAL del ASR (misma locucion partida) SI debe dar nombre', () => {
        expect(detectWakeIntroducedName('Soy Luis Okay flu soy', WAKE)).toBe('Luis')
        expect(detectWakeIntroducedName('Okay flu soy Luis', WAKE)).toBe('Luis')
    })

    it('casos limite: solo la MISMA locucion partida vale; el contexto NO', () => {
        // El intro previo solo ABRE la locucion (mismo caso del dueno).
        expect(detectWakeIntroducedName('Soy Luis Okay flu soy', WAKE)).toBe('Luis')
        // Contexto acumulado que NO abre con el intro -> no registra.
        expect(detectWakeIntroducedName('vamos a poner soy luis okay flu soy', WAKE)).toBe('')
        // Mandato COMPLETO tras la wake -> lo previo es contexto.
        expect(detectWakeIntroducedName('soy Luis okay flu pon una alarma', WAKE)).toBe('')
        // Mandato vacio -> no hay fragmento -> no registra.
        expect(detectWakeIntroducedName('ayer mi tia dijo soy Luis okay flu', WAKE)).toBe('')
    })
})
