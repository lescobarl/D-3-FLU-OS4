// ============================================================
// duenoP2Participantes - P2 (participantes en su seccion) + registro por VOZ.
// ------------------------------------------------------------
// P9.79 YA tiene el puente `refs.registerParticipant` (verde: voz -> Dexie).
// El defecto de CAMPO es otro: con la frase que el dueno dicto, el REGISTRO NO DISPARA
// y no entra nadie a la base -> el panel no muestra nada.
//   log 21:37:46  "Soy Luis Okay flu soy" -> detectWakeIntroducedName = "" (medido)
// Este caso nace ROJO y liga P2 con el registro (P6bis).
// ============================================================
import { describe, expect, it } from 'vitest'
import { registerSpeakerIdentityFromCommand } from '../src/voice/lib/speakerIdentityRegister.js'

function recogerAltas() {
    const altas: string[] = []
    const refs = {
        registerParticipant: (name: string) => {
            altas.push(name)
        },
    }
    return { altas, refs }
}

describe('P2 - el nombre dictado entra en la base de participantes', () => {
    it('con la forma canonica ("Okay flu soy Luis") SI entra', () => {
        const { altas, refs } = recogerAltas()
        registerSpeakerIdentityFromCommand({
            transcript: 'Okay flu soy Luis',
            speakerName: 'Hablante 1',
            clusters: [],
            refs: refs as never,
        })
        expect(altas).toEqual(['Luis'])
    })

    it('con la forma REAL del log ("Soy Luis Okay flu soy") tambien debe entrar', () => {
        const { altas, refs } = recogerAltas()
        registerSpeakerIdentityFromCommand({
            transcript: 'Soy Luis Okay flu soy',
            speakerName: 'Hablante 1',
            clusters: [],
            refs: refs as never,
        })
        // ROJO hoy: el mandato empieza en la wake y queda "soy" solo -> no hay nombre -> no entra.
        expect(altas, 'la locucion trae "soy luis"; debe registrarse').toEqual(['Luis'])
    })
})
