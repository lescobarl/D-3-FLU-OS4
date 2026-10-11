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
import { useIntegrationStore } from '../src/store/integrationStore'
import {
    commitUserTurnRow,
    updateTurnRowSpeaker,
    resolveRowSpeakerName,
    preserveProperSpeaker,
} from '../src/voice/lib/conversationTurnRow'
import { preflightEvidenceMeasured } from '../src/voice/lib/turnSpeakerPreflight.js'

const TURN_ROW = readFileSync('src/voice/lib/conversationTurnRow.ts', 'utf8')
const HOOK = readFileSync('src/voice/hooks/useFluVoiceAssistant.js', 'utf8')
const STREAM = readFileSync('src/voice/lib/conversationStreamCommit.js', 'utf8')
const LUIS = { registeredLabel: 'Hablante 1', registeredName: 'Luis' }

function etiquetaDe(_turnId: number): string {
    const h = useIntegrationStore.getState().conversationHistory
    for (let i = h.length - 1; i >= 0; i -= 1) {
        if (h[i]?.role === 'user') return String(h[i].speakerName || '')
    }
    return ''
}

beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [] })
})

describe('A) omitir la marca de evidencia NO es "medida" (fuente)', () => {
    it('los tres duelos de la fila declaran el default en FALSE', () => {
        expect(/(evidenciaAcustica = true)/.test(TURN_ROW), 'ningun dueno puede tener el default en true').toBe(false)
        expect(TURN_ROW.match(/evidenciaAcustica = false/g)?.length).toBe(3)
    })
    it('el PARTICIPANTE elegido NO estampa su nombre sin coincidencia (solo el mandato "soy X")', () => {
        // Medido 2026-10-11: tras elegir a Luis en el onboarding sus filas salian "Luis" sin decir
        // el comando. La unica fuente de nombre por DATO es el texto del mandato.
        expect(STREAM.includes("FUENTES_CON_IDENTIDAD = ['wake-intro']"), 'solo wake-intro es fuente por dato').toBe(true)
        expect(STREAM.includes("'wake-intro', 'pinned'"), 'el participante NO es fuente de nombre').toBe(false)
    })

    it('el resolver sincrono declara la evidencia con el dueno de la MEDIDA, no por "hay audio"', () => {
        expect(HOOK).toContain('preflightEvidenceMeasured(peekTurnSpeakerPreflight')
        expect(HOOK.includes('evidenciaAcustica: audioSnapshot.length > 0'), '"hay audio" NO es evidencia').toBe(false)
    })
    it('preflightEvidenceMeasured exige coincidencia (ready sin evidence NO es medida)', () => {
        expect(preflightEvidenceMeasured({ ready: true, evidence: false })).toBe(false)
        expect(preflightEvidenceMeasured({ ready: true })).toBe(false)
        expect(preflightEvidenceMeasured({ ready: false, evidence: true })).toBe(false)
        expect(preflightEvidenceMeasured(null)).toBe(false)
        expect(preflightEvidenceMeasured({ ready: true, evidence: true })).toBe(true)
    })
})

describe('A) la fila NO asciende al nombre sin evidencia declarada', () => {
    it('resolveRowSpeakerName sin evidencia deja la etiqueta automatica (no el nombre)', () => {
        expect(resolveRowSpeakerName('Hablante 1', false, LUIS)).toBe('Hablante 1')
        expect(resolveRowSpeakerName('Hablante 1', undefined as unknown as boolean, LUIS)).toBe('Hablante 1')
    })
    it('commitUserTurnRow SIN la marca NO estampa el nombre registrado', () => {
        commitUserTurnRow({ text: 'hola a todos', speakerName: 'Hablante 1', registeredSpeaker: LUIS, turnId: 1 } as never)
        expect(etiquetaDe(1), 'la etiqueta automatica no asciende sin coincidencia').toBe('Hablante 1')
    })
    it('updateTurnRowSpeaker SIN la marca NO estampa el nombre registrado', () => {
        commitUserTurnRow({ text: 'hola', speakerName: 'Hablante 1', turnId: 2 } as never)
        updateTurnRowSpeaker(2, 'Hablante 1', { registeredSpeaker: LUIS } as never)
        expect(etiquetaDe(2)).toBe('Hablante 1')
        updateTurnRowSpeaker(2, 'Hablante 1', { registeredSpeaker: LUIS, evidenciaAcustica: true } as never)
        expect(etiquetaDe(2), 'la evidencia de VOZ no introduce el nombre (solo lo confirma)').toBe('Hablante 1')
    })
    it('preserveProperSpeaker sin evidencia no deja pasar un nombre propio de otra voz', () => {
        expect(preserveProperSpeaker('Luis', 'Hablante 2', false, { evidenciaDeTexto: false })).toBe('Hablante 2')
    })
})
