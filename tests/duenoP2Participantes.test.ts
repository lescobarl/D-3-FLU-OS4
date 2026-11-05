// ============================================================
// duenoP2Participantes - P2 (participantes en su seccion) + registro por VOZ.
// ------------------------------------------------------------
// P9.79 YA tiene el puente `refs.registerParticipant` (verde: voz -> Dexie).
// El defecto de CAMPO es otro: con la frase que el dueno dicto, el REGISTRO NO DISPARA
// y no entra nadie a la base -> el panel no muestra nada.
//   log 21:37:46  "Soy Luis Okay flu" -> detectWakeIntroducedName = "" (medido)
// Este caso nace ROJO y liga P2 con el registro (P6bis).
//
// AMEND (mandato del dueno 2026-10-18): la base compara VECTORES; un nombre sin
// vector es basura. El registro entra CON la medida del turno que dice el nombre
// (`signatureVector`, la que la ruta real del comando toma de `getLastTurnSignature`).
// Sin medida no se escribe en la base: el nombre queda solo en el directorio/cluster.
// ============================================================
import { describe, expect, it } from 'vitest'
import { registerSpeakerIdentityFromCommand } from '../src/voice/lib/speakerIdentityRegister.js'

const VOZ_MEDIDA = [1, 0, 0]

function recogerAltas() {
    const altas: Array<{ name: string; vector?: number[] | null }> = []
    const refs = {
        registerParticipant: (name: string, _label?: string, voiceVector?: number[] | null) => {
            altas.push({ name, vector: voiceVector })
        },
    }
    return { altas, refs }
}

describe('P2 - el nombre dictado entra en la base de participantes', () => {
    it('con la forma canonica ("Okay flu soy Luis") SI entra, con su vector medido', () => {
        const { altas, refs } = recogerAltas()
        registerSpeakerIdentityFromCommand({
            transcript: 'Okay flu soy Luis',
            speakerName: 'Hablante 1',
            signatureVector: VOZ_MEDIDA,
            clusters: [],
            refs: refs as never,
        })
        expect(altas.map((alta) => alta.name)).toEqual(['Luis'])
        expect(altas[0].vector, 'la base conserva la evidencia MEDIDA de esa voz').toEqual(VOZ_MEDIDA)
    })

    it('con la forma REAL del log ("Soy Luis Okay flu soy") tambien debe entrar', () => {
        const { altas, refs } = recogerAltas()
        registerSpeakerIdentityFromCommand({
            transcript: 'Soy Luis Okay flu soy',
            speakerName: 'Hablante 1',
            signatureVector: VOZ_MEDIDA,
            clusters: [],
            refs: refs as never,
        })
        expect(altas.map((alta) => alta.name), 'la locucion trae "soy luis"; debe registrarse').toEqual(['Luis'])
    })

    it('DETECTOR: sin medida de voz NO se escribe un nombre sin vector en la base', () => {
        const { altas, refs } = recogerAltas()
        registerSpeakerIdentityFromCommand({
            transcript: 'Okay flu soy Luis',
            speakerName: 'Hablante 1',
            clusters: [],
            refs: refs as never,
        })
        expect(altas, 'un nombre sin vector es basura: no entra a la base').toEqual([])
    })
})
