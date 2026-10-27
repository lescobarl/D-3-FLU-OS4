// ============================================================
// vozEvidenciaPorOmisionGuard - A) NINGUNA VIA puede dar por "MEDIDA" la identidad por OMISION.
// ------------------------------------------------------------
// REGLA DEL DUENO (2026-10-11): "si no se midio, no hay evidencia -> etiqueta generica, nunca un
// nombre". OMITIR la marca de evidencia NO puede equivaler a "medida".
//
// DEFECTO MEDIDO (antes de esta pasada): los tres duelos de la fila declaraban
// `evidenciaAcustica = true` POR DEFECTO:
//   `preserveProperSpeaker(next, current, evidenciaAcustica = true)`
//   `updateTurnRowSpeaker(turnId, name, { evidenciaAcustica = true })`
//   `commitUserTurnRowInner({ ..., evidenciaAcustica = true })`
// y el resolver sincrono del hook declaraba la evidencia como `audioSnapshot.length > 0`
// ("hay audio" != "coincidio"). Con eso, omitir la marca ascendia a nombre propio SIN
// coincidencia (p. ej. la etiqueta 'Hablante 1' pasaba al nombre registrado 'Luis').
//
// PRUEBA DE DETECTOR (mutacion): si se vuelve a poner el default en `true`, o si el hook
// declara la evidencia por presencia de audio, este guard CAE.
//
// ESTE GUARD mide LO QUE SE VE (la etiqueta de la fila) y la fuente que la autoriza.
// ============================================================
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { hasVoiceMeasurement, isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow } from '../src/voice/conversation'
import { registerSpeakerIdentity } from '../src/voice/lib/speakerIdentityRegister.js'
import { resolveVoiceName } from '../src/voice/lib/speakerDirectory.js'
import { resolverEtiqueta } from '../src/voice/conversation/fila'

// Corte 2026-10-26: conversationTurnRow.ts y turnSpeakerPreflight.js se retiraron con
// la tuberia vieja. El dueno de la fila es el MODULO (pasivo.ts); el preflight no existe
// y la medida la declara quien MIDIO (hook, solo en la ruta con vector).
const PASIVO = readFileSync('src/voice/conversation/pasivo.ts', 'utf8')
const HOOK = readFileSync('src/voice/hooks/useFluVoiceAssistant.js', 'utf8')
const MOTOR = readFileSync('src/voice/compose/conversationMotorProducto.js', 'utf8')

function etiquetaDe(_turnId: number): string {
    const h = useIntegrationStore.getState().conversationHistory
    for (let i = h.length - 1; i >= 0; i -= 1) {
        if (h[i]?.role === 'user') return String(resolveRowSpeakerLabel(h[i]) || '')
    }
    return ''
}

beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [] })
})

describe('A) omitir la marca de evidencia NO es "medida" (fuente)', () => {
    it('el dueno de la fila exige la marca explicita; el default nunca es "medida"', () => {
        expect(/(evidenciaAcustica\s*=\s*true)/.test(PASIVO), 'ningun dueno puede tener el default en true').toBe(false)
        expect(PASIVO.includes('entrada.evidenciaAcustica === true'), 'solo la marca explicita cuenta').toBe(true)
        expect(HOOK.includes('payload.evidenciaAcustica === true'), 'el hook deriva la evidencia de la marca, no por omision').toBe(true)
    })
    it('el PARTICIPANTE elegido NO estampa su nombre sin coincidencia (solo el mandato "soy X")', () => {
        // Medido 2026-10-11: tras elegir a Luis en el onboarding sus filas salian "Luis" sin decir
        // el comando. La unica fuente de nombre por DATO es el texto del mandato, resuelto por la
        // politica unica (`resolveSpeakerNameFromUtterance`); corte 2026-10-26: la consume el HOOK
        // (ruta "soy X"), no el compositor, y la ruta `wake-intro`/`pinned` se retiro con la vieja.
        expect(HOOK.includes('resolveSpeakerNameFromUtterance(transcriptForIntro)'), 'solo el mandato es fuente por dato').toBe(true)
        expect(MOTOR.includes("'wake-intro', 'pinned'"), 'el participante NO es fuente de nombre').toBe(false)
        // Y el nombre, sin venir CONFIRMADO, no desplaza a la etiqueta medida (regla 5 del modulo).
        expect(
            resolverEtiqueta({
                voz: { nombre: 'Luis', nombreConfirmado: false, hablante: 'Hablante 1', continuidad: false },
                anterior: null,
                semilla: 'Hablante 1',
                esEtiquetaAnonima: isAutoSpeakerLabel,
            }),
            'un nombre sin confirmar no asciende la fila',
        ).toEqual({ etiqueta: 'Hablante 1', evidencia: 'medida' })
    })

    it('el hook declara la evidencia SOLO en la ruta que midio (nunca por "hay audio")', () => {
        expect(HOOK.includes('evidenciaAcustica: audioSnapshot.length > 0'), '"hay audio" NO es evidencia').toBe(false)
        // La marca true sale UNICAMENTE de la resolucion medida (vector del turno); las
        // demas rutas del hook la declaran false de forma explicita.
        const marcas = HOOK.match(/evidenciaAcustica: (true|false)/g) || []
        expect(marcas.filter((marca) => marca === 'evidenciaAcustica: true')).toHaveLength(1)
        expect(marcas.filter((marca) => marca === 'evidenciaAcustica: false')).toHaveLength(3)
    })
    it('hasVoiceMeasurement exige medida real (un vector sin energia NO es medida)', () => {
        // Corte 2026-10-26: `preflightEvidenceMeasured` se retiro con la tuberia vieja.
        // El gate vivo de "hay medida" es el vector: sin energia no hay evidencia.
        expect(hasVoiceMeasurement([1, 0, 0])).toBe(true)
        expect(hasVoiceMeasurement([])).toBe(false)
        expect(hasVoiceMeasurement([0, 0, 0])).toBe(false)
        expect(hasVoiceMeasurement(undefined), 'ausencia de vector (undefined) no es medida').toBe(false)
    })
})

describe('A) la fila NO asciende al nombre sin evidencia declarada', () => {
    it('commitUserTurnRow SIN la marca NO estampa un nombre propio', () => {
        commitUserTurnRow({ text: 'hola a todos', speakerName: 'Hablante 1', turnId: 1 } as never)
        expect(etiquetaDe(1), 'la etiqueta automatica no asciende sin coincidencia').toBe('Hablante 1')
    })
    it('SIN la medida el nombre no se liga a la voz; CON ella la voz CONFIRMA el nombre', () => {
        commitUserTurnRow({ text: 'hola', speakerName: 'Hablante 1', turnId: 2 } as never)
        // Corte 2026-10-26: updateTurnRowSpeaker se retiro. El registro liga el nombre a
        // la VOZ solo con la MEDIDA del turno; sin vector, el directorio queda intacto.
        registerSpeakerIdentity({ name: 'Luis', previousLabel: 'Hablante 1', clusters: [] })
        expect(resolveVoiceName('speaker_1'), 'sin coincidencia medida no se liga el nombre').toBe('')
        expect(etiquetaDe(2), 'la etiqueta automatica no asciende sin coincidencia').toBe('Hablante 1')
        registerSpeakerIdentity({
            name: 'Luis',
            previousLabel: 'Hablante 1',
            signatureVector: [1, 0, 0],
            clusters: [],
            refs: {},
        })
        expect(resolveVoiceName('speaker_1'), 'con coincidencia medida la voz CONFIRMA el nombre').toBe('Luis')
        expect(etiquetaDe(2), 'la fila escrita sin timbre conserva su etiqueta').toBe('Hablante 1')
    })
})
