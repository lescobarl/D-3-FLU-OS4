// ============================================================
// E0 — PROPIEDAD DEL BUFFER DE AUDIO (guard de COMPORTAMIENTO)
// ------------------------------------------------------------
// El embedding de voz se calcula en un worker y el payload viaja con
// `postMessage(payload, [audioBuffer])` (zero-copy). Si el buffer que se
// transfiere es el MISMO array que pasa el llamador, el transfer lo
// DESACOPLA (`.length`/`.byteLength` -> 0) y el array deja de ser usable.
//
// Medido (sesion real del dueno, 2026-10-05): el MISMO `audioSnapshot` lo
// consumen EN PARALELO la firma (`computeTurnSignature`, useFluVoiceAssistant
// 3310-3321) y la diarizacion (`resolveSpeaker`, :1570). El transfer de la
// firma dejaba el snapshot a 0 -> `SpeakerTrace vecLen=4 snap=0` y
// `VoiceId signature dim=512 empty=false snap=0` (imposible salvo por el
// detach) -> la diarizacion NUNCA ve audio y todo cae a "Hablante 1".
//
// Invariante: preparar/transferir el payload NO puede desacoplar el array
// del llamador.
// ============================================================
import { describe, it, expect } from 'vitest'
import { prepareTransferableAudio } from '../src/voice/lib/voiceIdWorkerClient.js'

/**
 * Marca de infraccion: el payload reutiliza el buffer del llamador (por tanto,
 * transferirlo lo desacoplaria). Devuelve [] si el payload es seguro.
 */
export function bufferOwnershipOffenders(
    prep: { audioBuffer?: ArrayBuffer | null },
    snapshot: Float32Array,
): string[] {
    return prep?.audioBuffer && prep.audioBuffer === snapshot.buffer
        ? ['el payload reutiliza el buffer del llamador (transferirlo lo desacoplaria)']
        : []
}

describe('E0 — el embedding no desacopla el buffer del llamador', () => {
    it('no reutiliza el buffer del llamador en el payload a transferir', () => {
        const snapshot = new Float32Array(1024)
        const prep = prepareTransferableAudio(snapshot)
        expect(prep.sampleCount).toBe(1024)
        expect(bufferOwnershipOffenders(prep, snapshot)).toEqual([])
        expect(prep.audioBuffer).not.toBe(snapshot.buffer)
    })

    it('tras transferir el payload, el array del llamador sigue vivo', () => {
        const snapshot = new Float32Array(1024)
        const prep = prepareTransferableAudio(snapshot)
        const channel = new MessageChannel()
        try {
            // Lo que hace `postImmediate`: postMessage con la lista de transfer.
            channel.port1.postMessage({ audioBuffer: prep.audioBuffer }, prep.transfer)
            expect(snapshot.length).toBe(1024)
            expect(snapshot.byteLength).toBe(1024 * 4)
        } finally {
            channel.port1.close()
            channel.port2.close()
        }
    })
})

// Prueba de detector (P2.4): el MISMO criterio marca la entrada infractora y no
// marca la sana; sin esto el guard seria teatro (verde para siempre).
describe('E0 — el detector no es decorativo', () => {
    it('marca el payload que reutiliza el buffer y no marca el que copia', () => {
        const snapshot = new Float32Array(8)
        expect(bufferOwnershipOffenders({ audioBuffer: snapshot.buffer }, snapshot)).toHaveLength(1)
        expect(bufferOwnershipOffenders({ audioBuffer: new ArrayBuffer(32) }, snapshot)).toEqual([])
        expect(bufferOwnershipOffenders({}, snapshot)).toEqual([])
    })
})
