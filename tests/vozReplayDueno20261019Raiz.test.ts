// ============================================================
// vozReplayDueno20261019Raiz - REPLAY de las RAICES de los 3 defectos del dueno
// ------------------------------------------------------------
// DEFECTOS REPORTADOS (sesion del dueno 2026-10-19):
//   1. "TOD ESTO HABLE YO luis y fue dejando algunos con hablante 1, de hecho el
//      primero le puso hablante 1".
//   2. "DUPLICO transcipcion en ultima frase y asi lo llevo a la conversacion:
//      1 2 3 23 4 34 4 5 6 7 8 9 10 4 5 6 7 8 910".
//   3. "Todo esto lo hablo una mujer y a algunos les puso luis, incluso tambien al
//      primero le puso hablante1".
//
// DATOS MEDIDOS (log preservado de la sesion, `$TEMP/flu-session-live.log`):
//   - 17:27:51 `Identity label="Hablante 1" reason=production-short-window-continuity
//     ... voiced=96000 ... pares=[Luis:0.827]` -> ventana de 2 s (96000 @48 kHz) con
//     similitud 0.827 al ancla registrada; el turno salio "Hablante 1".
//   - 17:28:34/37/41 `production-short-window-continuity ... voiced=96000
//     pares=[Luis:0.83, Hablante 1:0.162] -> Hablante 1`.
//   - 17:28:48 filas y caja con "voy a contar 1 2 3 23 4 34 4 5 6 7 8 9 10 ... 910".
//   - 17:30:39 `identity-register {"name":"Luis","anchor":"Hablante 2",
//     "turnMeasured":512,"baseVector":512,...,"registeredInBase":true}` -> la ruta de
//     RECONOCIMIENTO escribia la base y el cluster con la medida del turno.
//
// LIMITACION HONESTA: el log no guarda PCM ni los vectores de 512-D. Cada replay
// reconstruye EXACTAMENTE la medida anotada en el log (cosenos 0.83/0.162 y la
// secuencia de items del ASR) y ejecuta la funcion REAL del proyecto. No se simula
// embedding ni audio. Los vectores son 64-D ortogonales: el coseno es exacto y la
// dimension no cambia ninguna regla.
//
// QUE SE FIJA (y como se falsifica):
//   A. `mergeTranscriptText` NUNCA pega dos items numericos sin espacio: con el codigo
//      viejo (pegado `words[last] += next`) "1 2" + "3" daba "23".
//   B. `isShortUtteranceContext` decide por DURACION cuando hay audio medido: con el
//      codigo viejo "1 2" (2 palabras) + 2 s daba ventana CORTA y bloqueaba el nombre.
//   C. `applyKnownVoiceName` aplica una identidad CONOCIDA sin tocar la base, sin
//      re-anclar el directorio con la medida del turno y sin renombrar clusters: la
//      mujer no puede quedar "Luis".
// ============================================================
import { beforeEach, describe, expect, it } from 'vitest'
import { mergeTranscriptText } from '../src/voice/lib/transcriptDelta.js'
import { isShortUtteranceContext } from '../src/voice/lib/speakerClusters.js'
import { resolveConversationSpeaker } from '../src/voice/lib/voiceIdentity.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { commitUserTurnRow, updateTurnRowSpeaker } from '../src/voice/lib/conversationTurnRow'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import {
  registerVoiceName,
  resetVoiceDirectory,
  resolveVoiceIdentity,
  voiceVectorModel,
} from '../src/voice/lib/speakerDirectory.js'
import { applyKnownVoiceName } from '../src/voice/lib/speakerIdentityRegister.js'
import { useIntegrationStore } from '../src/store/integrationStore'

// ---- vectores con coseno EXACTO (64-D, L2 = 1) -----------------------------
const DIM = 64

function basis(index: number): number[] {
  const v: number[] = new Array(DIM).fill(0)
  v[index] = 1
  return v
}

/** q con coseno EXACTO `toA` contra A y `toB` contra B (A, B, resto ortogonales). */
function query(toA: number, toB: number): number[] {
  const rest = Math.sqrt(Math.max(0, 1 - toA * toA - toB * toB))
  return [toA, rest, toB, ...new Array(DIM - 3).fill(0)]
}

const VOZ_LUIS = basis(0)
const VOZ_MUJER = basis(1)
const VOZ_HABLANTE_1 = basis(2)

const userRows = () =>
  useIntegrationStore.getState().conversationHistory.filter((r) => r.role === 'user')

/** Etiqueta que VE el usuario para cada fila (la funcion REAL del display). */
const etiquetasMostradas = () => userRows().map((row) => resolveRowSpeakerLabel(row))

beforeEach(() => {
  useIntegrationStore.getState().resetConversationHistory()
  resetVoiceDirectory()
})

describe('raiz A · el ASR entrega numeros sueltos y NO se pegan (defecto 2)', () => {
  it('"1 2" + "3" se separa con espacio: nunca "23"', () => {
    const merged = mergeTranscriptText('voy a contar 1 2', '3')
    expect(merged, 'el item numerico se pego: ' + JSON.stringify(merged)).toBe('voy a contar 1 2 3')
    expect(merged).not.toContain('23')
  })

  it('"9" + "10" se separa con espacio: nunca "910"', () => {
    const merged = mergeTranscriptText('contando 7 8 9', '10')
    expect(merged, 'el item numerico se pego: ' + JSON.stringify(merged)).toBe('contando 7 8 9 10')
    expect(merged).not.toContain('910')
  })

  it('la continuacion numerica sobre una caja de UN token tambien queda separada', () => {
    expect(mergeTranscriptText('9', '10')).toBe('9 10')
    expect(mergeTranscriptText('2', '3')).toBe('2 3')
  })
})

describe('raiz B · la DURACION manda en "ventana corta" (defectos 1 y 3)', () => {
  it('2 s de voz con "1 2" NO es ventana corta (el codigo viejo decia que si)', () => {
    expect(
      isShortUtteranceContext({
        utteranceText: '1 2',
        voicedSampleCount: 96000,
        sampleRate: 48000,
        thresholds: FLU_CONFIG.voiceIdentity.capture.conversationSpeakerThresholds,
      }),
      'una ventana sostenida de 2 s no puede clasificarse corta por el conteo de palabras',
    ).toBe(false)
  })

  it('500 ms de voz SI es ventana corta (la regla sigue viva para audio breve)', () => {
    expect(
      isShortUtteranceContext({
        utteranceText: '1 2',
        voicedSampleCount: 24000,
        sampleRate: 48000,
        thresholds: FLU_CONFIG.voiceIdentity.capture.conversationSpeakerThresholds,
      }),
    ).toBe(true)
  })

  it('sin audio medido, el texto decide; sin transcripcion no hay locucion que medir', () => {
    expect(isShortUtteranceContext({ utteranceText: 'hola hola', voicedSampleCount: 0 })).toBe(true)
    expect(isShortUtteranceContext({ utteranceText: '', voicedSampleCount: 96000, sampleRate: 48000 })).toBe(false)
  })
})

describe('raiz B · diarizacion: la voz del dueno conserva su nombre en turno sostenido', () => {
  it('Luis 0.83 / Hablante 1 0.162 con 2 s -> "Luis" (antes: production-short-window-continuity)', () => {
    const clusters: any[] = [
      { label: 'Luis', signature: [...VOZ_LUIS], signatureHistory: [[...VOZ_LUIS]] },
      { label: 'Hablante 1', signature: [...VOZ_HABLANTE_1], signatureHistory: [[...VOZ_HABLANTE_1]] },
    ]
    const diagnosis: Record<string, unknown> = {}
    const speaker = resolveConversationSpeaker({
      signatureVector: query(0.83, 0.162),
      speakerClusters: clusters,
      lastSpeaker: 'Hablante 1',
      lastSignature: VOZ_HABLANTE_1,
      // El ASR traia solo dos palabras numericas al resolver la identidad; el audio
      // sostuvo 2 s (96000 muestras @48 kHz), la MISMA medida del log del dueno.
      utteranceText: '1 2',
      voicedSampleCount: 96000,
      sampleRate: 48000,
      atTurnBoundary: true,
      thresholds: FLU_CONFIG.voiceIdentity.capture.conversationSpeakerThresholds,
      diagnosis,
    } as any)
    expect(speaker, 'el nombre registrado no puede perderse: ' + JSON.stringify(diagnosis)).toBe('Luis')
    expect(diagnosis.reason).toBe('production-reidentify')
  })

  it('FALSIFICADOR: la MISMA voz y similitudes con 500 ms vuelve a ser continuidad anonima', () => {
    const clusters: any[] = [
      { label: 'Luis', signature: [...VOZ_LUIS], signatureHistory: [[...VOZ_LUIS]] },
      { label: 'Hablante 1', signature: [...VOZ_HABLANTE_1], signatureHistory: [[...VOZ_HABLANTE_1]] },
    ]
    const diagnosis: Record<string, unknown> = {}
    const speaker = resolveConversationSpeaker({
      signatureVector: query(0.83, 0.162),
      speakerClusters: clusters,
      lastSpeaker: 'Hablante 1',
      lastSignature: VOZ_HABLANTE_1,
      utteranceText: '1 2',
      voicedSampleCount: 24000,
      sampleRate: 48000,
      atTurnBoundary: true,
      thresholds: FLU_CONFIG.voiceIdentity.capture.conversationSpeakerThresholds,
      diagnosis,
    } as any)
    expect(speaker).toBe('Hablante 1')
    expect(diagnosis.reason).toBe('production-short-window-continuity')
  })
})

describe('raiz C · reconocer una identidad NO envenena la base ni a otra voz (defecto 3)', () => {
  it('el match devuelve el vector CONOCIDO (ancla), no la medida consultada', () => {
    const model = voiceVectorModel()
    const base = [{ name: 'Luis', vector: [...VOZ_LUIS], model }]
    const consulta = query(0.9, 0)
    const match = resolveVoiceIdentity(consulta, { candidates: base })
    expect(match?.name).toBe('Luis')
    // El ancla viaja con la identidad: es el vector de la BASE, no la consulta.
    expect(match?.vector).toEqual(VOZ_LUIS)
    expect(match?.vector).not.toEqual(consulta)
  })

  it('reconocer al dueno con la etiqueta de la MUJER no nombra a la mujer ni toca sus filas', () => {
    // Filas del escenario: el dueno (dos turnos) y la mujer (un turno limpio).
    commitUserTurnRow({ text: 'hola hola como estan todos', speakerName: 'Hablante 1', signature: VOZ_LUIS, evidenciaAcustica: true, turnId: 1 })
    commitUserTurnRow({ text: 'estoy probando la transcripcion', speakerName: 'Hablante 1', signature: VOZ_LUIS, evidenciaAcustica: true, turnId: 2 })
    commitUserTurnRow({ text: 'hoy me robo el estilo lolita', speakerName: 'Hablante 2', signature: VOZ_MUJER, evidenciaAcustica: true, turnId: 3 })

    const model = voiceVectorModel()
    const base = [{ name: 'Luis', vector: [...VOZ_LUIS], model }]
    const match = resolveVoiceIdentity(VOZ_LUIS, { candidates: base })
    expect(match?.name).toBe('Luis')

    // La ruta del reconocimiento recibe el ANCLA conocida (no la medida del turno).
    const resultado = applyKnownVoiceName({
      name: match!.name,
      previousLabel: 'Hablante 2', // la etiqueta del turno es de la MUJER
      anchorVector: match!.vector,
    })

    expect(resultado.registered).toBe(true)
    expect(resultado.rowsChanged, 'solo las filas del dueno se congelan').toBe(2)
    expect(etiquetasMostradas(), 'la mujer NO hereda el nombre').toEqual([
      'Luis',
      'Luis',
      'Hablante 2',
    ])
    // La comparacion es sobre VECTORES: el timbre de la mujer NO resuelve a un nombre
    // (la sesion puede responder "que VOZ es esta" con su clave, pero sin nombre).
    expect(resolveVoiceIdentity(VOZ_MUJER)?.name || '', 'la mujer no puede resolver a Luis').toBe('')
    expect(resolveVoiceIdentity(VOZ_LUIS)?.name).toBe('Luis')
    // La fila de la mujer conserva su clave y su etiqueta escritas.
    const filaMujer = userRows()[2]
    expect(String(filaMujer?.speakerId || '')).toBe('speaker_2')
    expect(String(filaMujer?.speakerName || '')).toBe('Hablante 2')
  })

  it('un 0.741 al ancla NO confirma la identidad registrada (medido 21:22:52)', () => {
    // MEDIDO: `identity-recognized {"name":"Luis","label":"Hablante 1","voice":"speaker_1",
    // "rows":1}` y, dos segundos despues, la MISMA voz medida `pares=[Luis:0.741,...]`. La
    // fila de la mujer compartia la clave reciclada `speaker_1` y el freeze la renombro "Luis"
    // con el piso de "misma voz" (0.66). La identidad REGISTRADA se confirma a 0.76.
    commitUserTurnRow({ text: 'estoy probando la transcripcion', speakerName: 'Hablante 1', signature: VOZ_LUIS, evidenciaAcustica: true, turnId: 23 })
    const cerca = query(0.741, 0)
    commitUserTurnRow({ text: 'ramen el clásico bu', speakerName: 'Hablante 1', signature: cerca, evidenciaAcustica: true, turnId: 24 })
    // Las dos filas comparten la MISMA clave (el vicio que produjo el defecto).
    expect(userRows().map((row) => String(row.speakerId))).toEqual(['speaker_1', 'speaker_1'])

    const resultado = applyKnownVoiceName({ name: 'Luis', previousLabel: 'Hablante 1', anchorVector: VOZ_LUIS })
    expect(resultado.rowsChanged, 'solo la fila cuyo TIMBRE es el ancla').toBe(1)
    expect(etiquetasMostradas(), 'la fila a 0.741 no se afirma como Luis').toEqual(['Luis', 'Hablante 1'])
  })

  it('una etiqueta automatica TARDIA no degrada al dueno que su timbre confirma', () => {
    // MEDIDO 21:23:08: `row-update {"turnId":26,"voz":"speaker_1","nombre":"Hablante 3",
    // "evidencia":false,"medida":512}` reescribio la etiqueta de la fila. La pregunta "es
    // alguien" tiene dueno unico (`resolveVoiceIdentity`): si el timbre resuelve una
    // identidad, la etiqueta automatica no se escribe.
    registerVoiceName('speaker_1', 'Luis', { vector: VOZ_LUIS })
    const { id } = commitUserTurnRow({ text: 'hola hola como estan', speakerName: 'Hablante 1', signature: VOZ_LUIS, evidenciaAcustica: true, turnId: 26 })
    expect(updateTurnRowSpeaker(26, 'Hablante 3', { evidenciaAcustica: false, vector: VOZ_LUIS })).toBe(false)
    expect(resolveRowSpeakerLabel(userRows().find((row) => row.id === id) || {})).toBe('Luis')

    // FALSIFICADOR: si el timbre NO resuelve a nadie (0.641, la medida real del log), la
    // etiqueta medida de ESA voz SI se escribe: es su unica etiqueta verdadera.
    const cerca = query(0.641, 0)
    const { id: idMujer } = commitUserTurnRow({ text: 'el precio de los raments', speakerName: 'Hablante 1', signature: cerca, evidenciaAcustica: true, turnId: 27 })
    expect(updateTurnRowSpeaker(27, 'Hablante 3', { evidenciaAcustica: false, vector: cerca })).toBe(true)
    expect(resolveRowSpeakerLabel(userRows().find((row) => row.id === idMujer) || {})).toBe('Hablante 3')
  })
})
