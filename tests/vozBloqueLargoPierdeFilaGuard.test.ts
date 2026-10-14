// ============================================================
// vozBloqueLargoPierdeFilaGuard - GUARD del defecto MEDIDO en el log del dueno
// ------------------------------------------------------------
// EVIDENCIA (debug.log del dueno, 2026-10-07 14:10:13-14:17:33 UTC):
//   - Turno 3 (14:10:23): "Okay Flow buen dia como estas Platicame de ti" -> fila.
//   - Turno 4 (14:10:40): "Okay Flow Soy Luis"                            -> fila.
//   - Turno 5 (14:11:13): "okay Este es un es una prueba de la diarizacion..." ->
//     `RowTrace ... replace=true`. El commit de un bloque NUEVO pidio REEMPLAZAR.
//   - Turnos 6 y 7 (14:12:40 / 14:17:33): bloques largos CONSECUTIVOS sin respuesta
//     de FLU en medio (TV): si dos bloques seguidos comparten la primera palabra
//     (la propia wake "okay/Okay"), el segundo REEMPLAZA la fila del primero y la
//     transcripcion del bloque anterior se pierde de la conversacion ("lo escribe
//     en ULTIMA FRASE pero no lo pasa a la conversacion").
//
// CAUSA: `utterancesAsrProgress(previous, next)` devolvia true cuando solo
// coincidia la PRIMERA palabra ("com" -> "Comes" es progreso de UN token, pero
// "Okay Flow ..." y "okay Este ..." son locuciones DISTINTAS). Con eso
// `resolveLogRowAction` -> `canReplaceLastOnCommit` marcaba replaceLast=true y
// `commitUserTurnRow` reemplazaba la fila anterior.
//
// Nace ROJO: hoy el commit del bloque nuevo pide replaceLast y la fila del bloque
// anterior se pierde. Verde cuando cada bloque largo conserva SU fila.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest'
import { resolveLogRowAction, utterancesAsrProgress } from '../src/voice/lib/conversationStream.js'
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow.js'
import { useIntegrationStore } from '../src/store/integrationStore'

// Textos REALES del log (turnos 3 y 5), sin acentos para el caso reproducible.
const BLOQUE_3 = 'Okay Flow buen dia como estas Platicame de ti'
const BLOQUE_5 =
  'okay Este es un es una prueba de la diarizacion en este caso vamos a revisar como funciona yo soy Luis estoy hablando a ver como me registra este si ya me registra como Luis o a ver que es lo que hace'

const userRows = () =>
  useIntegrationStore.getState().conversationHistory.filter((r) => r.role === 'user')

/** Detector: ¿el par se trata como la MISMA locucion creciendo? */
export function collapseMarker(prior: string, next: string): boolean {
  return utterancesAsrProgress(prior, next)
}

describe('bloques largos: la locucion NUEVA no puede reemplazar la fila anterior', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory()
  })

  it('dos locuciones DISTINTAS con la misma primera palabra NO son la misma revision ASR', () => {
    expect(collapseMarker(BLOQUE_3, BLOQUE_5)).toBe(false)
  })

  it('el commit de un bloque NUEVO no pide replaceLast sobre el bloque anterior', () => {
    const action = resolveLogRowAction({
      activeLogStream: false,
      newParagraph: false,
      turnBoundary: false,
      turnCommit: true,
      lastEmitted: BLOQUE_3,
      lastCommitted: BLOQUE_3,
      capture: BLOQUE_5,
      logRowContext: {},
    })
    expect(action.replaceLast).toBe(false)
  })

  it('escenario real (dos bloques CONSECUTIVOS, sin respuesta de FLU en medio): DOS filas', () => {
    commitUserTurnRow({ text: BLOQUE_3, turnId: 3 })
    const action = resolveLogRowAction({
      activeLogStream: false,
      newParagraph: false,
      turnBoundary: false,
      turnCommit: true,
      lastEmitted: BLOQUE_3,
      lastCommitted: BLOQUE_3,
      capture: BLOQUE_5,
      logRowContext: {},
    })
    commitUserTurnRow({ text: BLOQUE_5, turnId: 5, replaceLast: action.replaceLast })

    const rows = userRows()
    expect(rows.map((r) => r.text)).toEqual([BLOQUE_3, BLOQUE_5])
  })
})

// ------------------------------------------------------------
// P11.16 - MEDIDO 2026-10-14 16:10:36 (su log): Chrome trunco el final de una locucion larga y
// reentrego la COLA como resultado NUEVO. El commit de la segunda pidio replaceLast (comparten
// un BLOQUE) y el reuso DESCARTO su texto (la fila solo se INSERTA): 107 palabras que no
// llegaron a ninguna fila (checker D5). La CABEZA decide: una locucion que SIGUE empieza donde
// empezo el ancla; una que arranca en la COLA del ancla es OTRA locucion -> fila NUEVA.
// ------------------------------------------------------------
const ANCLA_CON_COLA =
  'para alzar el vuelo en unos cuantos segundos el avion se alejo perdiendose en el cielo negro de esa noche la aeronave era pilotada por el capitan un experimentado piloto de 53 anos de edad'
const LOCUCION_NUEVA_DESDE_LA_COLA =
  'el avion se alejo perdiendose en el cielo negro de esa noche la aeronave era pilotada por el capitan un experimentado piloto de 53 anos de edad el primer oficial El vuelo transcurria con normalidad y a las pocas horas la torre de control de la Ciudad de Mexico recibio el mensaje del piloto'

describe('P11.16 - la locucion que arranca en la COLA no reutiliza la fila (su texto no se descarta)', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory()
  })

  it('el commit de la locucion NUEVA no pide replaceLast sobre el ancla', () => {
    const action = resolveLogRowAction({
      activeLogStream: false,
      newParagraph: false,
      turnBoundary: false,
      turnCommit: true,
      lastEmitted: ANCLA_CON_COLA,
      lastCommitted: ANCLA_CON_COLA,
      capture: LOCUCION_NUEVA_DESDE_LA_COLA,
      logRowContext: {},
    })
    expect(action.replaceLast, 'reusar la fila DESCARTA el texto de la locucion nueva').toBe(false)
  })

  it('escenario real: DOS filas, los dos textos completos (nada de la locucion nueva se pierde)', () => {
    commitUserTurnRow({ text: ANCLA_CON_COLA, turnId: 61 })
    const action = resolveLogRowAction({
      activeLogStream: false,
      newParagraph: false,
      turnBoundary: false,
      turnCommit: true,
      lastEmitted: ANCLA_CON_COLA,
      lastCommitted: ANCLA_CON_COLA,
      capture: LOCUCION_NUEVA_DESDE_LA_COLA,
      logRowContext: {},
    })
    commitUserTurnRow({ text: LOCUCION_NUEVA_DESDE_LA_COLA, turnId: 62, replaceLast: action.replaceLast })
    const rows = userRows()
    expect(rows.map((r) => r.text)).toEqual([ANCLA_CON_COLA, LOCUCION_NUEVA_DESDE_LA_COLA])
  })
})
describe('PRUEBA DE DETECTOR (el detector no es decorativo): discrimina progreso real de colapso', () => {
  it('marca la revision ASR de UN token (com -> Comes pollo) como progreso', () => {
    expect(collapseMarker('com', 'Comes pollo')).toBe(true)
  })

  it('NO marca dos locuciones distintas que solo comparten la primera palabra', () => {
    expect(collapseMarker(BLOQUE_3, BLOQUE_5)).toBe(false)
    expect(collapseMarker('Okay Flu pon musica', 'Okay Flu sube el volumen')).toBe(false)
  })
})
