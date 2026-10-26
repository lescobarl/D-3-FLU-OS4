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
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'
import { useIntegrationStore } from '../src/store/integrationStore'
import {
    commitUserTurnRow,
    updateTurnRowSpeaker,
} from '../src/voice/lib/conversationTurnRow'
import { preflightEvidenceMeasured } from '../src/voice/lib/turnSpeakerPreflight.js'
import { resolverEtiqueta } from '../src/voice/conversation/fila'

const TURN_ROW = readFileSync('src/voice/lib/conversationTurnRow.ts', 'utf8')
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
    it('los duelos de la fila declaran el default en FALSE', () => {
        expect(/(evidenciaAcustica = true)/.test(TURN_ROW), 'ningun dueno puede tener el default en true').toBe(false)
        // DOS duelos reales de la fila (updateTurnRowSpeaker + commitUserTurnRow). El tercero
        // era `preserveProperSpeaker`, retirado por duplicar la regla sin consumidor.
        expect(TURN_ROW.match(/evidenciaAcustica = false/g)?.length).toBe(2)
    })
    it('el PARTICIPANTE elegido NO estampa su nombre sin coincidencia (solo el mandato "soy X")', () => {
        // Medido 2026-10-11: tras elegir a Luis en el onboarding sus filas salian "Luis" sin decir
        // el comando. La unica fuente de nombre por DATO es el texto del mandato: el compositor del
        // motor la toma de `resolveSpeakerNameFromUtterance` (la ruta `wake-intro` se retiro).
        expect(MOTOR.includes('resolveSpeakerNameFromUtterance(texto)'), 'solo el mandato es fuente por dato').toBe(true)
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
    it('commitUserTurnRow SIN la marca NO estampa un nombre propio', () => {
        commitUserTurnRow({ text: 'hola a todos', speakerName: 'Hablante 1', turnId: 1 } as never)
        expect(etiquetaDe(1), 'la etiqueta automatica no asciende sin coincidencia').toBe('Hablante 1')
    })
    it('updateTurnRowSpeaker SIN la marca NO escribe el nombre; CON ella lo CONFIRMA', () => {
        commitUserTurnRow({ text: 'hola', speakerName: 'Hablante 1', turnId: 2 } as never)
        updateTurnRowSpeaker(2, 'Luis', { evidenciaAcustica: false } as never)
        expect(etiquetaDe(2), 'sin coincidencia medida no se escribe el nombre proprio').toBe('Hablante 1')
        updateTurnRowSpeaker(2, 'Luis', { evidenciaAcustica: true } as never)
        expect(etiquetaDe(2), 'con coincidencia medida la voz CONFIRMA el nombre').toBe('Luis')
    })
})
