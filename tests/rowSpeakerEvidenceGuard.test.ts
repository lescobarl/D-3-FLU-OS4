/**
 * rowSpeakerEvidenceGuard — La fila del turno NO estampa un nombre propio sin
 * evidencia acustica declarada.
 *
 * DEFECTO MEDIDO (traza del dueno, 2026-10-08 17:47:31-17:48:25): con el hablante
 * "Luis" registrado, TODAS las filas salian `speaker:"Luis","evidencia":false`,
 * incluida la locucion de OTRA persona ("eso fue la chica"). La etiqueta
 * AUTOMATICA de la diarizacion ("Hablante 1") se convertia en nombre propio ANTES
 * de la regla de evidencia: `App.tsx` (`resolveRegisteredSpeakerName`) y
 * `conversationTurnRow.ts` (`resolveSpeakerAlias`) NO miraban `evidenciaAcustica`.
 * `preserveProperSpeaker` solo bloqueaba etiquetas AUTOMATICAS sin evidencia; un
 * nombre propio ya estampado pasaba siempre.
 *
 * INVARIANTE (dueno UNICO de la decision: `resolveRowSpeakerName`):
 *   (a) etiqueta AUTOMATICA sin evidencia -> fila SIN hablante (se completa
 *       despues por identidad de turno, `updateTurnRowSpeaker`);
 *   (b) la MISMA etiqueta CON evidencia -> nombre de la persona registrada;
 *   (c) un nombre propio INTRODUCIDO por el texto ("soy luis") no se bloquea;
 *   (d) el alias de sesion (`renameSpeakerRows`) tampoco entra sin evidencia.
 *
 * Nace ROJO: `resolveRowSpeakerName` no existe; hoy la fila sale "Luis".
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import {
  commitUserTurnRow,
  renameSpeakerRows,
  resetSpeakerAliases,
  resolveRowSpeakerName,
} from '../src/voice/lib/conversationTurnRow'

const LUIS = { registeredLabel: 'Hablante 1', registeredName: 'Luis' }

const rows = () => useIntegrationStore.getState().conversationHistory.filter((r) => r.role === 'user')
const lastSpeaker = () => String(rows().at(-1)?.speakerName ?? '')

describe('dueno unico: sin evidencia la fila no lleva nombre propio', () => {
  it('etiqueta automatica registrada SIN evidencia -> "" (Hoy: "Luis")', () => {
    expect(resolveRowSpeakerName('Hablante 1', false, LUIS)).toBe('')
  })

  it('la MISMA etiqueta CON evidencia -> nombre de la persona', () => {
    expect(resolveRowSpeakerName('Hablante 1', true, LUIS)).toBe('Luis')
  })

  it('nombre propio introducido por el texto no se bloquea (soy luis)', () => {
    expect(resolveRowSpeakerName('Luis', false, LUIS)).toBe('Luis')
  })

  it('sin registro y sin evidencia, la etiqueta automatica tampoco entra', () => {
    expect(resolveRowSpeakerName('Hablante 2', false, LUIS)).toBe('')
  })
})

describe('la fila real (escritor unico) obedece la misma regla', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory()
    resetSpeakerAliases()
  })

  it('etiqueta registrada, commit SIN evidencia -> fila sin hablante (Hoy: "Luis")', () => {
    const r = commitUserTurnRow({
      text: 'eso fue la chica y le puso como hablante a Luis',
      speakerName: 'Hablante 1',
      registeredSpeaker: LUIS,
      evidenciaAcustica: false,
      turnId: 30,
    })
    expect(r.id).toBeTruthy()
    expect(lastSpeaker()).toBe('')
  })

  it('etiqueta registrada, commit CON evidencia -> fila con el nombre', () => {
    commitUserTurnRow({
      text: 'hola hola como estan',
      speakerName: 'Hablante 1',
      registeredSpeaker: LUIS,
      evidenciaAcustica: true,
      turnId: 1,
    })
    expect(lastSpeaker()).toBe('Luis')
  })

  it('alias de sesion (renameSpeakerRows) SIN evidencia -> fila sin hablante', () => {
    commitUserTurnRow({ text: 'hola a todos como estan', speakerName: 'Hablante 1', turnId: 1 })
    renameSpeakerRows(['Hablante 1'], 'Luis')
    commitUserTurnRow({ text: 'otra locucion distinta', speakerName: 'Hablante 1', evidenciaAcustica: false, turnId: 2 })
    expect(lastSpeaker()).toBe('')
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('la MISMA etiqueta cambia de veredicto solo por la evidencia', () => {
    const sinEvidencia = resolveRowSpeakerName('Hablante 1', false, LUIS)
    const conEvidencia = resolveRowSpeakerName('Hablante 1', true, LUIS)
    expect(conEvidencia).not.toBe(sinEvidencia)
    expect(sinEvidencia).toBe('')
    expect(conEvidencia).toBe('Luis')
  })

  it('no marca lo legitimo: el nombre propio del texto pasa sin evidencia', () => {
    expect(resolveRowSpeakerName('Luis', false, LUIS)).toBe('Luis')
  })
})
