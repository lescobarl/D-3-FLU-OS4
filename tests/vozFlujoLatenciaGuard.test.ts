import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  WATCHDOG_ACTIONS,
  resolveWatchdogStep,
} from '../src/voice/lib/asrWatchdog'
import { getConversationRestartConfig } from '../src/voice/lib/fluConfig'

const root = process.cwd()
const leer = (ruta: string) => readFileSync(join(root, ruta), 'utf8')
const baseline = JSON.parse(leer('scripts/voz-flujo-baseline.json'))

describe('flujo de voz: watchdog y cierre medidos', () => {
  const cfg = getConversationRestartConfig(true)

  it('con voz reciente y SIN locución abierta SÍ reinicia: golpe previo al habla', () => {
    const step = resolveWatchdogStep({
      sinceMeaningful: Number(cfg.stallMs) + 1000,
      sinceRebuild: Number(cfg.stallRebuildMinMs) + 1,
      recognitionActive: true,
      hasRecentSpeech: true,
      hasOpenLocution: false,
      restartCfg: cfg,
    })
    expect(step).toEqual({ action: WATCHDOG_ACTIONS.REBUILD, kind: 'stall' })
  })

  it('con voz reciente y locución ABIERTA no reinicia: la frase viva manda', () => {
    const step = resolveWatchdogStep({
      sinceMeaningful: Number(cfg.stallMs) + 1000,
      sinceRebuild: Number(cfg.stallRebuildMinMs) + 1,
      recognitionActive: true,
      hasRecentSpeech: true,
      hasOpenLocution: true,
      restartCfg: cfg,
    })
    expect(step.action).toBe(WATCHDOG_ACTIONS.NONE)
  })

  it('sin voz y sin resultado SÍ reinicia por stall', () => {
    const step = resolveWatchdogStep({
      sinceMeaningful: Number(cfg.stallMs) + 1000,
      sinceRebuild: Number(cfg.stallRebuildMinMs) + 1,
      recognitionActive: true,
      hasRecentSpeech: false,
      restartCfg: cfg,
    })
    expect(step).toEqual({ action: WATCHDOG_ACTIONS.REBUILD, kind: 'stall' })
  })

  it('con LOCUCIÓN ABIERTA no reinicia por stall: el tick real de la mujer (18:22:17)', () => {
    // Tick REAL del log: sinceMeaningful=8383, cooldown vencido, Chrome activo
    // y el piso de identidad sin ver su voz (hasRecentSpeech=false). Antes,
    // este tick reconstruía y tiraba la frase que Chrome estaba oyendo.
    const step = resolveWatchdogStep({
      sinceMeaningful: 8383,
      sinceRebuild: Number(cfg.stallRebuildMinMs) + 1,
      recognitionActive: true,
      hasRecentSpeech: false,
      hasOpenLocution: true,
      restartCfg: cfg,
    })
    expect(step).toEqual({ action: WATCHDOG_ACTIONS.NONE })
  })

  it('falsificación: sin locución abierta el MISMO tick sí reconstruye', () => {
    const step = resolveWatchdogStep({
      sinceMeaningful: 8383,
      sinceRebuild: Number(cfg.stallRebuildMinMs) + 1,
      recognitionActive: true,
      hasRecentSpeech: false,
      hasOpenLocution: false,
      restartCfg: cfg,
    })
    expect(step).toEqual({ action: WATCHDOG_ACTIONS.REBUILD, kind: 'stall' })
  })

  it('Chrome MUDO con la locución abierta SIN texto se reconstruye (19:05, 37,2 s)', () => {
    // MEDIDO en el log preservado (sesión de la mujer): locución cf3ef5c1
    // abierta 01:06:10.259 y cerrada 01:06:47.482 con `descarte:sinTexto`;
    // CERO resultados de Chrome y CERO rebuilds en la ventana (el stall exige
    // sin locución y el dead exige inactivo). Sin una palabra escrita no hay
    // frase que cortar: el rebuild recupera el motor.
    const step = resolveWatchdogStep({
      sinceMeaningful: baseline.measuredMudo.locucionAbiertaSinTextoMs,
      sinceRebuild: Number(cfg.stallRebuildMinMs) + 1,
      recognitionActive: true,
      hasRecentSpeech: false,
      hasOpenLocution: true,
      hasEmptyOpenLocution: true,
      openLocutionMs: baseline.measuredMudo.locucionAbiertaSinTextoMs,
      restartCfg: cfg,
    })
    expect(step).toEqual({ action: WATCHDOG_ACTIONS.REBUILD, kind: 'mudo' })
  })

  it('la MISMA ventana con texto en la abierta no toca el motor', () => {
    const step = resolveWatchdogStep({
      sinceMeaningful: baseline.measuredMudo.locucionAbiertaSinTextoMs,
      sinceRebuild: Number(cfg.stallRebuildMinMs) + 1,
      recognitionActive: true,
      hasRecentSpeech: false,
      hasOpenLocution: true,
      hasEmptyOpenLocution: false,
      restartCfg: cfg,
    })
    expect(step).toEqual({ action: WATCHDOG_ACTIONS.NONE })
  })

  it('el umbral queda POR ENCIMA del tick de 8,4 s de 18:22 y DENTRO de la ventana real', () => {
    const umbral = Number(cfg.muteOpenLocutionMs)
    expect(umbral).toBeGreaterThan(8383)
    expect(umbral).toBeLessThanOrEqual(baseline.measuredMudo.locucionAbiertaSinTextoMs)
    // El tick REAL de 18:22 con la locución aún vacía: el umbral lo protege
    // (ahí la locución abierta era una frase viva y el rebuild la partía).
    const tick1822 = {
      sinceMeaningful: 8383,
      sinceRebuild: Number(cfg.stallRebuildMinMs) + 1,
      recognitionActive: true,
      hasRecentSpeech: false,
      hasOpenLocution: true,
      hasEmptyOpenLocution: true,
      openLocutionMs: Number(cfg.muteOpenLocutionMs),
      restartCfg: cfg,
    }
    expect(resolveWatchdogStep(tick1822)).toEqual({ action: WATCHDOG_ACTIONS.NONE })
    // Justo debajo del umbral no hay rebuild; en el umbral, sí.
    expect(resolveWatchdogStep({ ...tick1822, sinceMeaningful: umbral - 1 })).toEqual({
      action: WATCHDOG_ACTIONS.NONE,
    })
    expect(resolveWatchdogStep({ ...tick1822, sinceMeaningful: umbral })).toEqual({
      action: WATCHDOG_ACTIONS.REBUILD,
      kind: 'mudo',
    })
  })

  it('mudo TEMPRANO: voz medida y locución vacía -> UN rebuild al compás del respaldo', () => {
    // MEDIDO 2026-11-13 14:32: último resultado de Chrome 14:32:39.844; voz
    // medida ok 1.290/1.440/1.110/1.500 ms entre 14:32:48.501 y 14:32:53.223;
    // primer interim de la mujer 14:32:59.751 (19.907 s): los primeros ~17 s
    // de su frase no los transcribió nadie. El respaldo 2026-11-07 reconstruía
    // cada ~4,2-4,6 s y Chrome escribía ~4 s después del rebuild
    // (03:07:37.5 -> 03:07:41.9). Este es ESE primer golpe.
    const tick = {
      sinceMeaningful: Number(cfg.stallMs),
      sinceRebuild: Number(cfg.stallRebuildMinMs) + 1,
      recognitionActive: true,
      hasRecentSpeech: true,
      hasOpenLocution: true,
      hasEmptyOpenLocution: true,
      openLocutionMs: Number(cfg.muteOpenLocutionMs),
      mudoTempranoHecho: false,
      restartCfg: cfg,
    }
    expect(Number(cfg.stallMs), 'el compás medido del respaldo').toBe(4200)
    expect(resolveWatchdogStep(tick)).toEqual({
      action: WATCHDOG_ACTIONS.REBUILD,
      kind: 'mudo',
      early: true,
    })
    // La ventana REAL de hoy (19.907 s) cae en la misma rama: el umbral decide
    // el PRIMER tick; el candado evita los siguientes.
    expect(resolveWatchdogStep({ ...tick, sinceMeaningful: 19907 })).toEqual({
      action: WATCHDOG_ACTIONS.REBUILD,
      kind: 'mudo',
      early: true,
    })
  })

  it('el candado permite UN mudo temprano por locución: sin él vuelve el bucle de 18:22', () => {
    const tick = {
      sinceMeaningful: 19907,
      sinceRebuild: Number(cfg.stallRebuildMinMs) + 1,
      recognitionActive: true,
      hasRecentSpeech: true,
      hasOpenLocution: true,
      hasEmptyOpenLocution: true,
      openLocutionMs: Number(cfg.muteOpenLocutionMs),
      restartCfg: cfg,
    }
    expect(resolveWatchdogStep({ ...tick, mudoTempranoHecho: true })).toEqual({
      action: WATCHDOG_ACTIONS.NONE,
    })
    // La red de 20 s NO se retira: si el primer golpe no bastó, el `mudo` de
    // `muteOpenLocutionMs` sigue actuando (hoy disparó a los 20.083 s).
    expect(
      resolveWatchdogStep({
        ...tick,
        sinceMeaningful: 20083,
        mudoTempranoHecho: true,
      }),
    ).toEqual({ action: WATCHDOG_ACTIONS.REBUILD, kind: 'mudo' })
  })

  it('falsificación: sin voz medida el MISMO tick no toca el motor (18:22 queda cerrado)', () => {
    // Con el umbral del pegado (4-6 s a ciegas) este tick habría disparado;
    // es el tick real de 18:22 (hasRecentSpeech=false) al compás de `stallMs`.
    // La rama temprana EXIGE voz medida: no reabre el caso cerrado.
    const tick = {
      sinceMeaningful: 4200,
      sinceRebuild: Number(cfg.stallRebuildMinMs) + 1,
      recognitionActive: true,
      hasRecentSpeech: false,
      hasOpenLocution: true,
      hasEmptyOpenLocution: true,
      openLocutionMs: Number(cfg.stallMs),
      mudoTempranoHecho: false,
      restartCfg: cfg,
    }
    expect(resolveWatchdogStep(tick)).toEqual({ action: WATCHDOG_ACTIONS.NONE })
  })

  it('falsificación 18:44: el reloj global NO dispara sobre una locución recién abierta', () => {
    // Tick REAL 2026-11-13 18:44:08.183: `sinceMeaningful=4238` venía del
    // turno ANTERIOR; la locución 4d84debd tenía 0,57 s de abierta y 43 ms de
    // audio propio. El mudo temprano la cortó, el comando quedó fuera de su
    // ventana de medida (240 ms de voz) y la fila cerró «Hablante XX» sin
    // `vozId`: el nombre no alcanzó a las filas anteriores ni posteriores.
    const tick = {
      sinceMeaningful: 4238,
      sinceRebuild: Number(cfg.stallRebuildMinMs) + 1,
      recognitionActive: true,
      hasRecentSpeech: true,
      hasOpenLocution: true,
      hasEmptyOpenLocution: true,
      openLocutionMs: 43,
      mudoTempranoHecho: false,
      restartCfg: cfg,
    }
    expect(resolveWatchdogStep(tick)).toEqual({ action: WATCHDOG_ACTIONS.NONE })
    // La red de 20 s tampoco dispara sobre esa locución fresca: el hueco
    // global largo no es evidencia de que ESTA locución esté trabada.
    expect(
      resolveWatchdogStep({
        ...tick,
        sinceMeaningful: Number(cfg.muteOpenLocutionMs) + 83,
      }),
    ).toEqual({ action: WATCHDOG_ACTIONS.NONE })
  })

  it('onend muerto se recupera aunque haya voz reciente', () => {
    const step = resolveWatchdogStep({
      sinceEnd: Number(cfg.deadRecognitionMs) + 1,
      recognitionActive: false,
      restartPending: false,
      hasRecentSpeech: true,
      restartCfg: cfg,
    })
    expect(step).toEqual({ action: WATCHDOG_ACTIONS.REBUILD, kind: 'dead' })
  })

  it('watchdogTick alimenta la voz desde el dueño de voicedActivity', () => {
    const src = leer('src/voice/hooks/useLocalAsrFallback.js')
    expect(src).toMatch(/countVoicedSamplesInBlocks\(chunksRef\.current/)
    expect(src).toMatch(/getConversationMinVoicedSamples\(rate\)/)
    expect(src).toMatch(/hasRecentSpeech/)
  })

  it('la decisión stall protege la locución abierta y no exige silencio sin locución', () => {
    const src = leer('src/voice/lib/asrWatchdog.js')
    expect(src).toMatch(/!hasOpenLocution[\s\S]{0,260}silentMicStallMs/)
    expect(src).toMatch(/!hasOpenLocution[\s\S]{0,260}stallMs/)
    // Sin locución abierta no hay frase que cortar: la voz/ruido de sala no
    // puede volver a bloquear el rebuild previo al habla (defecto 2026-11-13).
    expect(src).not.toMatch(/!hasRecentSpeech[\s\S]{0,260}silentMicStallMs/)
    expect(src).not.toMatch(/!hasRecentSpeech[\s\S]{0,260}stallMs/)
    const consumidor = leer('src/voice/hooks/useLocalAsrFallback.js')
    expect(consumidor).toMatch(/hasOpenLocution: hayLocucionAbierta/)
    const hook = leer('src/voice/hooks/useFluVoiceAssistant.js')
    expect(hook).toMatch(/instantanea\?\.\(\)\?\.locucionAbierta/)
  })

  it('watchdogTick aporta «sin texto en la abierta» desde la instantánea del módulo', () => {
    const consumidor = leer('src/voice/hooks/useLocalAsrFallback.js')
    expect(consumidor).toMatch(/hasEmptyOpenLocution: sinTextoEnLaAbierta/)
    // El candado del mudo temprano: una vez por locución, llaveado por el id.
    expect(consumidor).toMatch(/mudoTempranoHecho,/)
    expect(consumidor).toMatch(/openLocutionMs,/)
    expect(consumidor).toMatch(/locucionMs=\$\{Math\.round\(openLocutionMs\)\}/)
    expect(consumidor).toMatch(/mudoTempranoLocucionRef\.current = locucionAbierta\.locutionId/)
    // El log publica la evidencia exacta que usó el paso (el analizador la mide).
    expect(consumidor).toMatch(/sinTextoEnAbierta=\$\{sinTextoEnLaAbierta\}/)
    expect(consumidor).toMatch(/locucionId=\$\{locucionAbierta\?\.locutionId \|\| '-'}/)
    expect(consumidor).toMatch(/mudoTemprano=\$\{step\.early === true\}/)
    const paso = leer('src/voice/lib/asrWatchdog.js')
    expect(paso).toMatch(/hasEmptyOpenLocution[\s\S]{0,260}muteOpenLocutionMs/)
    expect(paso).toMatch(/openLocutionMs[\s\S]{0,160}stallMs/)
    expect(paso).toMatch(/openLocutionMs[\s\S]{0,160}muteOpenLocutionMs/)
    expect(paso).toMatch(/hasRecentSpeech[\s\S]{0,200}stallMs/)
    expect(paso).toMatch(/!mudoTempranoHecho[\s\S]{0,200}stallMs/)
    expect(paso).toMatch(/early: true/)
    expect(paso).toMatch(/'stall'\|'dead'\|'mudo'/)
  })

  it('el cierre del producto corta la entrada antes de encolar y no vuelca PCM', () => {
    const src = leer('src/voice/conversation/producto.ts')
    const desde = src.indexOf('cerrar: (motivo)')
    const cierre = src.slice(desde)
    expect(cierre).toMatch(
      /estadoMotor = 'cerrando'[\s\S]*descartarAudioPendiente\(\)[\s\S]*cierreEnCurso = encadenar/,
    )
    expect(cierre).not.toMatch(/encolarAudioPendiente/)
  })

  it('el cierre de conversación espera el FINAL de Chrome con la entrada ya cortada', () => {
    const src = leer('src/voice/hooks/useFluVoiceAssistant.js')
    const desde = src.indexOf('const cerrarMotorConversacion')
    const hasta = src.indexOf('useEffect(', desde)
    expect(src.slice(desde, hasta)).toMatch(/await motor\.cerrar\(motivo\)/)
    // La entrada de audio al módulo se corta en el mismo stop: el final que se
    // espera no puede abrir otra locución (motivo del orden viejo).
    expect(src).toMatch(/onRawPcmBlock:[\s\S]{0,120}if \(!isListeningRef\.current\) return/)
    const stop = src.slice(
      src.indexOf('const stopListening'),
      src.indexOf('const toggleListening'),
    )
    expect(stop).toMatch(/\[REC\] stop: request/)
    expect(stop).toMatch(/await cerrarMotorConversacion\(closing \? 'user' : 'system'\)/)
    // MEDIDO 2026-11-12 18:25:32: stop a las .597, final «cerrando escucha» a
    // las 33.006 (409 ms). Se espera el final con el motor abierto y recién
    // entonces se cierra; al revés, el final se tiraba y quedaba el parcial.
    expect(stop.indexOf('isListeningRef.current = false')).toBeLessThan(
      stop.indexOf('await finalizeRecognition()'),
    )
    expect(stop.indexOf('await finalizeRecognition()')).toBeLessThan(
      stop.indexOf('await cerrarMotorConversacion'),
    )
  })

  it('el medidor real (voz:log) está enchufado a la línea base', () => {
    const src = leer('scripts/analiza-voz-log.mjs')
    expect(src).toMatch(/voz-flujo-baseline\.json/)
    expect(src).toMatch(/BARRERA FLUJO/)
    expect(src).toMatch(/aperturasTrasStop/)
    expect(src).toMatch(/rebuild kind=mudo/)
    expect(src).toMatch(/sinTextoEnAbierta=false/)
    expect(src).toMatch(/mudoTemprano=true/)
    expect(src).toMatch(/rebuildMudoTempranoPorLocucion/)
    expect(src).toMatch(/mudoTempranoAntesDelCompas/)
    expect(src).toMatch(/bautizoEtiquetaCompartida/)
    expect(src).toMatch(/process\.exitCode = 1/)
  })

  it('la línea base congela el antes y prohíbe los casos medidos', () => {
    expect(baseline.measuredBefore.stallConVozUltimos3s).toBeGreaterThan(0)
    expect(baseline.measuredBefore.locucionesCerradasTrasStop).toBeGreaterThan(0)
    expect(baseline.forbiddenNow.stallConVoz).toBe(0)
    expect(baseline.forbiddenNow.rebuildMudoConTexto).toBe(0)
    expect(baseline.forbiddenNow.locucionesConTextoTrasStop).toBe(0)
    expect(baseline.forbiddenNow.cierreTrasStopMs).toBeLessThanOrEqual(2500)
    expect(baseline.measuredBefore.locucionesConTextoTrasStop).toBeGreaterThan(0)
    // La ventana muda medida cubre de sobra el umbral: el rebuild habría caído DENTRO.
    expect(baseline.measuredMudo.locucionAbiertaSinTextoMs).toBeGreaterThan(
      Number(cfg.muteOpenLocutionMs),
    )
    expect(baseline.measuredMudo.rebuildsEnLaVentana).toBe(0)
    // La ventana REAL de hoy (19.907 s) con voz medida: el compás del respaldo
    // (4,2 s) es el PRIMER golpe; el umbral de 20 s sigue como red.
    expect(baseline.measuredMudoTemprano.compasRespaldoMs).toBe(Number(cfg.stallMs))
    expect(baseline.measuredMudoTemprano.primerInterimMs).toBeGreaterThan(
      Number(cfg.stallMs),
    )
    expect(baseline.forbiddenNow.rebuildMudoTempranoPorLocucion).toBe(1)
    expect(baseline.forbiddenNow.mudoTempranoAntesDelCompas).toBe(0)
    expect(baseline.forbiddenNow.bautizoEtiquetaCompartida).toBe(0)
  })
})
