/**
 * Motor ÚNICO de escucha (§9): Whisper WASM + segmentador VAD.
 *
 * Una sola implementación del contrato de reconocimiento que ya consume
 * `useFluVoiceAssistant` (`onstart/onresult/onerror/onend`). No hay Chrome
 * SpeechRecognition: el texto lo produce Whisper on-device y el audio para
 * diarización sale del MISMO PCM.
 *
 * Infra incluida:
 *  - Eco/barge-in: mientras FLU habla (TTS) se descarta el audio y su resultado.
 *  - Parciales en vivo (interim) latest-only, sin encolar atrasos.
 *  - Reintento del worker: al fallar, se recrea en la próxima petición.
 *  - Motor continuo: no se recrea por "stall" (el watchdog no aplica).
 *
 * Entrada: PCM del AudioWorklet (`pushAudio`). Salida: eventos con forma
 * `{ resultIndex, results: [{ isFinal, 0: { transcript } }] }`.
 */
import { createVoiceSegmenter, getAsrConfig, getAsrSampleRate } from './voiceActivitySegmenter.js'
import { countSpeechLikeSamples, rmsOf } from '../voicedActivity.js'
import { createWhisperWasmTranscriber } from './whisperWasmTranscriber.js'
import { isSpeechSynthesisSpeaking } from '../fluSpeech.js'
import { logCaughtError } from '../../../lib/caughtError.ts';
import { DEFAULT_SAMPLE_RATE } from '../audioConstants.js'
import { downsample } from './resample.js'
import { concatFloat32 } from '../pcmChunks.js'

function buildResultEvent(transcript, isFinal, metrics = null) {
  // Forma estándar de Web Speech API:
  //   event.results = [ resultado ]  (lista de resultados)
  //   resultado[0] = { transcript }  (alternativas)
  //   resultado.isFinal / resultado.length
  // `metrics` es ADITIVO (contrato Chrome intacto): evidencia acustica del audio
  // transcrito, para que el hook no emita un final sin habla (Whisper-tiny alucina).
  const result = {
    0: { transcript, confidence: 1 },
    isFinal: Boolean(isFinal),
    length: 1,
  }
  const event = { resultIndex: 0, results: [result] }
  if (metrics) event.metrics = metrics
  return event
}

/**
 * @param {{ sampleRate?: number, transcriber?: object, finalTranscriber?: object, interimTranscriber?: object }} [options]
 */
export function createWhisperRecognitionEngine({
  sampleRate = DEFAULT_SAMPLE_RATE,
  transcriber,
  finalTranscriber,
  interimTranscriber,
} = {}) {
  const asrConfig = getAsrConfig()
  const targetRate = getAsrSampleRate(asrConfig)
  const whisper = finalTranscriber || transcriber || createWhisperWasmTranscriber()
  // §9: si no hay modelo interim distinto, se reutiliza el MISMO transcriptor
  // (un solo worker/modelo). Antes corrían `base`+`tiny` a la vez: contención.
  const interimModelId = asrConfig.interimModelId || asrConfig.modelId
  const sameModel = interimModelId === asrConfig.modelId
  const whisperInterim =
    interimTranscriber ||
    transcriber ||
    (sameModel
      ? whisper
      : createWhisperWasmTranscriber({
          modelId: interimModelId,
          dtype: asrConfig.interimDtype || asrConfig.dtype,
        }))
  const segmenter = createVoiceSegmenter(asrConfig.vad, targetRate)
  const partialsEnabled = asrConfig.partialsEnabled !== false
  const partialIntervalMs = Math.max(300, Number(asrConfig.partialIntervalMs) || 900)
  const partialWindowMs = Math.max(500, Number(asrConfig.partialWindowMs) || 3000)
  const partialMinSamples = Math.max(
    1,
    Math.round(((Number(asrConfig.partialMinMs) || 600) / 1000) * targetRate),
  )

  let active = false
  let inSpeech = false
  let turnChunks = []
  let lastPartialAt = 0
  let queue = Promise.resolve()
  let partialInFlight = false
  let partialDirty = false
  let finalInFlight = false

  const engine = {
    onstart: null,
    onresult: null,
    onerror: null,
    onend: null,
    get active() {
      return active
    },
    /** §9: motor continuo. El watchdog de "stall" (heredado de Chrome SR, que sí
     *  se detenía) no aplica: no debe re-crearlo en silencio. */
    get continuous() {
      return true
    },
    /**
     * Carga el modelo del worker SIN activar la captura: precalentamiento del
     * motor local mientras el reconocedor principal escucha (la grabacion
     * 45aeb8e2 perdio su primera frase por cargar el modelo EN el swap).
     * @returns {void}
     */
    preload() {
      Promise.resolve(whisper.preload?.()).catch((e) => { logCaughtError('[catch] src/voice/lib/asr/whisperRecognitionEngine.js', e) })
      if (whisperInterim !== whisper) Promise.resolve(whisperInterim.preload?.()).catch((e) => { logCaughtError('[catch] src/voice/lib/asr/whisperRecognitionEngine.js', e) })
    },
    start() {
      if (active) return
      active = true
      engine.preload()
      if (typeof engine.onstart === 'function') engine.onstart()
    },
    stop() {
      if (!active) {
        if (typeof engine.onend === 'function') engine.onend()
        return
      }
      active = false
      for (const event of segmenter.flush()) applySegmentEvent(event)
      resetTurn()
      if (typeof engine.onend === 'function') engine.onend()
    },
    /**
     * Espera a que la COLA de transcripciones ya encoladas termine.
     *
     * Contrato de consumo: quien empuja audio mas rapido que el modelo (replay,
     * test, importacion) DEBE esperar aqui ANTES de `stop()`; si no, `stop()`
     * marca `active=false` y los resultados encolados se descartan en
     * `enqueueTranscription` (`if (!active || !text) return`). No es un sleep: la
     * promesa es la de la propia cola.
     *
     * @returns {Promise<void>} resuelve al vaciarse la cola pendiente en ese momento.
     */
    whenIdle() {
      return queue.then(
        () => undefined,
        () => undefined,
      )
    },
    abort() {
      active = false
      segmenter.reset()
      resetTurn()
    },
    pushAudio(samples, rate = sampleRate) {
      if (!active) return
      // Eco/barge-in: mientras FLU habla no se captura ni se transcribe.
      if (isSpeechSynthesisSpeaking()) {
        segmenter.reset()
        resetTurn()
        return
      }
      const audio = downsample(samples, rate, targetRate)
      if (!audio.length) return
      if (inSpeech) turnChunks.push(audio)
      for (const event of segmenter.push(audio)) applySegmentEvent(event)
      maybeEmitPartial()
    },
    dispose() {
      active = false
      segmenter.reset()
      resetTurn()
      whisper.dispose?.()
      if (whisperInterim !== whisper) whisperInterim.dispose?.()
    },
  }

  function resetTurn() {
    inSpeech = false
    turnChunks = []
    lastPartialAt = 0
    partialDirty = false
  }

  /**
   * Evidencia ACUSTICA del audio que se transcribe: duracion, muestras de HABLA
   * (VAD speech-like, dueno unico `voicedActivity`) y RMS. Se mide sobre el MISMO
   * audio que recibe Whisper, no sobre el buffer del micro (una ventana con 0,2 s
   * de voz no puede pasar por un turno de 3 s).
   *
   * @param {Float32Array} audio
   * @returns {{ durationMs: number, speechLikeMs: number, rms: number }}
   */
  function measure(audio) {
    const durationMs = (audio.length / Math.max(1, targetRate)) * 1000
    const speechLikeMs = (countSpeechLikeSamples(audio, { sampleRate: targetRate }) / Math.max(1, targetRate)) * 1000
    return { durationMs, speechLikeMs, rms: rmsOf(audio) }
  }

  function applySegmentEvent(event) {
    if (event.type === 'speech-start') {
      inSpeech = true
      turnChunks = []
      lastPartialAt = Date.now()
      return
    }
    if (event.type === 'speech-end') {
      inSpeech = false
      partialDirty = false
      enqueueFinal(event.samples)
      turnChunks = []
    }
  }

  function maybeEmitPartial() {
    if (!partialsEnabled || !inSpeech) return
    // No competir con el final: mientras el turno se transcribe (modelo grande),
    // no se lanzan parciales (se peleaban la CPU y el final tardaba más).
    if (finalInFlight) return
    const now = Date.now()
    if (now - lastPartialAt < partialIntervalMs) return
    lastPartialAt = now
    // Latest-only: si ya hay un parcial en vuelo, NO se encola otro; se marca
    // "sucio" y al terminar se transcribe UNA vez con el audio más reciente.
    // Así no se acumulan parciales atrasados (que mostraban texto viejo).
    if (partialInFlight) {
      partialDirty = true
      return
    }
    void runPartial()
  }

  async function runPartial() {
    partialInFlight = true
    try {
      const full = concatFloat32(turnChunks)
      // Solo los últimos `partialWindowMs`: no re-transcribir todo el turno.
      const maxSamples = Math.round((partialWindowMs / 1000) * targetRate)
      const audio = full.length > maxSamples ? full.subarray(full.length - maxSamples) : full
      if (audio.length >= partialMinSamples) {
        const text = await whisperInterim.transcribe(audio)
        if (active && inSpeech && text && typeof engine.onresult === 'function') {
          engine.onresult(buildResultEvent(text, false, measure(audio)))
        }
      }
    } catch (e) {
        logCaughtError('[catch] src/voice/lib/asr/whisperRecognitionEngine.js', e);
      // Parcial descartable: no afecta el final.
    } finally {
      partialInFlight = false
      if (partialDirty && active && inSpeech) {
        partialDirty = false
        lastPartialAt = Date.now()
        void runPartial()
      }
    }
  }

  function enqueueFinal(audio) {
    if (!audio?.length) return
    // NO se descarta el audio corto: "ok flu" debe llegar al hook, que tiene la
    // ventana de wake (`wakeWordCommandDelayMs: 3000`) para unirlo al comando.
    // El antialucinación se resuelve con initial_prompt + no_repeat_ngram_size.
    enqueueTranscription(audio, true)
  }

  function enqueueTranscription(audio, isFinal) {
    if (isFinal) finalInFlight = true
    queue = queue.then(async () => {
      if (!active || !audio.length) {
        if (isFinal) finalInFlight = false
        return
      }
      if (isSpeechSynthesisSpeaking()) {
        if (isFinal) finalInFlight = false
        return
      }
      try {
        const text = await whisper.transcribe(audio)
        if (!active || !text) return
        if (typeof engine.onresult === 'function') engine.onresult(buildResultEvent(text, isFinal, measure(audio)))
      } catch (error) {
        logCaughtError('[catch] src/voice/lib/asr/whisperRecognitionEngine.js', error);
        // Falla del worker/WASM (p. ej. el modelo no cargó) o de red real al
        // descargar el modelo. Se reintenta al recrear el worker; NO se etiqueta
        // todo como 'network' (eso confundía con el error del motor Chrome y
        // ocultaba la causa real).
        const name = String(error?.name || '')
        const message = String(error?.message || error)
        const isRealNetwork =
          name === 'TypeError' || /network|failed to fetch|fetch failed/i.test(message)
        if (typeof engine.onerror === 'function') {
          engine.onerror({
            error: isRealNetwork ? 'network' : 'engine-error',
            name,
            message,
          })
        }
      } finally {
        if (isFinal) finalInFlight = false
      }
    })
  }

  return engine
}
