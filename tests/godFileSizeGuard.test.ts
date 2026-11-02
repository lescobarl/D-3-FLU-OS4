/**
 * P6.6 - godFileSize: los god-files no vuelven a crecer.
 *
 * CONTEXTO MEDIDO: P6.6 saco de src/App.tsx cuatro bloques enteros (rutas de tab,
 * guardas de tipo, accion de configuracion y fast-path de juegos) con sus
 * pruebas: 5391 -> 4684 lineas (-13%). El trabajo de EXTRACCION de App.tsx queda
 * cerrado aqui; los otros god-files (voice/**) siguen intactos y les toca a
 * P6.7+.
 *
 * REGLA (trinquete, shrink-only): cada god-file de TECHOS tiene un techo escrito
 * que es EXACTAMENTE su tamano medido hoy. Solo puede bajar. Subir un techo es
 * una decision explicita que se ve en el diff (y se justifica en el ledger), no
 * un efecto colateral: sin este trinquete, un bloque que hoy vive extraido
 * podria volver a App.tsx sin que nadie lo note.
 *
 * El detector se prueba con una medida sintetica infractora y con una que no lo
 * es (prueba de mutacion): sin eso el guard podria estar en verde midiendo otra
 * cosa, o midiendo mal y tapando el crecimiento que dice vigilar.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Techos por fichero, medidos con `lineas()` el 2026-09-22 (sin margen: una
 * linea nueva obliga a decidir, no a pasar).
 */
export const TECHOS: Record<string, number> = {
  // +2 en P7.8: el ciclo de vida de los puentes se saco a src/app/fluBridges.ts, pero la
  // LLAMADA y su import siguen teniendo que estar en App (los manejadores se asignan ahi).
  // -43 al sacar la lista de componentes monitoreados a su dueno
  // (DEFAULT_MONITORED_COMPONENTS): App dejo de recopiarla.
  // -158 (2026-10-23): los helpers de despacho a nivel modulo (isRedundantTextWorkspace,\n  // buildArbiterOptions, resolveDomainScopedIntent y los dev hooks) salieron a\n  // src/app/appDispatchHelpers.ts: funciones puras de sus argumentos, sin estado del\n  // componente. App los importa y no conserva copia.\n  'src/App.tsx': 4485, // 5391 antes de P6.6
  // -40 en P8.32: el bloque de parametros del turno salio a src/voice/lib/contractParams.js
  // (buildContractParams), dueno unico de la lista de entradas del contrato de voz.
  // -3: la frase viva no se vacia al cerrar/entregar el turno (spec del dueno 2026-10-11).
  // -146 (2026-10-20): el modo pasivo dejo de tener un SEGUNDO resolver de diarizacion
  // (segmentAudio + matchSegmentNames + voiceProfiles + distanceToLast, con sus propios
  // umbrales). La decision de hablante la toma el dueno canonico
  // (resolveSpeakerIdentityFromVector -> resolveConversationSpeaker).
  // -515 (2026-10-25): corte de la tuberia vieja de conversacion; el hook ya no monta
  // ingress/cola/consumidor y solo conserva captura + el motor del producto.
  // -1263 (2026-10-26): el commit de la fila de usuario y la diarizacion pasaron al
  // modulo (commitUserTurnRow, decidirIdentidad); el hook solo orquesta captura.
  // +15 (2026-11-01): el snapshot del turno usa el tramo/firma canonicos de la
  // fila (`turnSnapshot.js`) y deduplica por `locutionId`. El buffer circular
  // dejaba `audioStart==audioEnd` y `signature:null` pasados 30 s; el hook
  // conserva solo el cableado y su dedupe. El cuerpo vive en el helper.
  'src/voice/hooks/useFluVoiceAssistant.js': 2621,
  // -66: 49 claves de config SIN lector (prometian comportamiento sin efecto) se borraron,
  // con su barrera (configConEfectoGuard).
  // -50 al cortar la tuberia vieja de conversacion (2026-10-25): el tracer, la
  // segmentacion ASR y las claves de la escucha retirada salieron con sus lectores.
  // -64 (2026-10-26): 29 claves de la diarizacion retirada (tope/fusion de clusters,
  // preflight, dictado, schedule pasivo, ingressGuards) sin lector tras la tuberia vieja;
  // conversationMaxAutoSpeakers SE CONSERVA y lo lee nextAutoSpeakerLabel (fallback del tope).
  // -23 mas (2026-10-26, misma pasada): stickySpeaker/strictCosineDiarization/turnBoundary*,
  // stripPriorTurns* y transcriptSettle* (lectores en la tuberia retirada).
  // -6 mas (2026-10-26, misma pasada): soloSpeakerSticky/diarizeIntervalMs/turnAudioOverlapMs
  // se fueron con sus unicos lectores (retirados por deadExportsGuard).
  // +2 (2026-11-01): minNewSpeakerWords y cosineExistingMatch; la grabacion
  // corta confirmo que con solo 8 s el hombre quedaba `Hablante ?`.
  'src/voice/lib/fluConfig.js': 2559,
  // -62 (2026-11-02): se eliminaron los clientes muertos
  // requestParticipantEvaluation/requestConversationSummary (la via viva es
  // services/gemini.ts por /contract y mode:minute).
  'src/voice/lib/gemini.js': 1786,
}

/** Lineas de un texto, con el mismo criterio con que se midieron los techos. */
export function lineas(texto: string): number {
  return texto.split(/\r?\n/).length
}

/** Ficheros de `techos` que superan su techo, con la desviacion. */
export function excedidos(
  techos: Record<string, number>,
  medir: (fichero: string) => number,
): string[] {
  return Object.keys(techos)
    .filter((f) => medir(f) > techos[f])
    .map((f) => `${f}: ${medir(f)} > techo ${techos[f]}`)
}

const ROOT = process.cwd()

const medirFichero = (f: string): number => lineas(readFileSync(join(ROOT, f), 'utf8'))

describe('P6.6 godFileSize - el trinquete de tamano no se puede aflojar solo', () => {
  it('el detector marca al que pasa del techo y deja pasar al que no (prueba de mutacion)', () => {
    const techos = { 'a.ts': 100, 'b.ts': 50 }
    const medidas: Record<string, number> = { 'a.ts': 100, 'b.ts': 51 }
    expect(excedidos(techos, (f) => medidas[f])).toEqual(['b.ts: 51 > techo 50'])
    expect(excedidos(techos, () => 10)).toEqual([])
  })

  it('ningun god-file pasa de su techo', () => {
    const fuera = excedidos(TECHOS, medirFichero)
    expect(
      fuera,
      'estos god-files volvieron a crecer; saca el codigo a un modulo de src/app,\n' +
        'o sube el techo de forma deliberada (y justifica el nuevo tamano):\n  ' +
        fuera.join('\n  '),
    ).toEqual([])
  })

  it('los techos siguen siendo techos de verdad: cada uno coincide con el fichero', () => {
    const conMargen = Object.keys(TECHOS).filter((f) => medirFichero(f) < TECHOS[f] - 40)
    expect(
      conMargen,
      'un fichero BAJO de golpe y el techo no se aprieta (el trinquete solo puede bajar):\n  ' +
        conMargen.join('\n  '),
    ).toEqual([])
  })
})
