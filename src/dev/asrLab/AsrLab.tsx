/**
 * AsrLab — Arnés DEV para comparar transcriptores (NO producción).
 *
 * Se abre en `http://localhost:5173/asr-lab` (solo `import.meta.env.DEV`).
 * Mide, con el MISMO audio, latencia y texto de cada candidato:
 *  - Chrome SpeechRecognition (nativo)
 *  - Whisper WASM (tiny/base) usando el transcriptor real del motor
 *  - Vosk (si `vosk-browser` está instalado y hay modelo servido)
 *  - sherpa-onnx (marcado como pendiente de integrar)
 *
 * No toca la unificación ni el flujo de producción.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { OPENROUTER_DEFAULTS } from '../../core/config/sharedConfig'
import { acquireSpeechRecognition } from '../../voice/lib/speechRecognitionLocal'
import { logCaughtError } from '../../lib/caughtError';
import { SPEECH_LOCALES } from '../../core/config/localeConfig'

const RATE = 16000

type ProbeId = 'chrome' | 'whisper-tiny' | 'whisper-base' | 'vosk' | 'sherpa' | 'gemini'

interface ProbeResult {
  id: ProbeId
  text: string
  ms: number
  error?: string
}

function concat(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((acc, c) => acc + c.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!input.length || fromRate <= toRate) return input
  const ratio = fromRate / toRate
  const length = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let c = start; c < end; c += 1) sum += input[c]
    out[i] = sum / Math.max(1, end - start)
  }
  return out
}

async function capturePcm(ms: number): Promise<Float32Array> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const AudioCtx = (window.AudioContext || window.webkitAudioContext) as typeof AudioContext
  const ctx = new AudioCtx()
  const src = ctx.createMediaStreamSource(stream)
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
  }
  src.connect(processor)
  processor.connect(ctx.destination)
  await new Promise((resolve) => setTimeout(resolve, ms))
  processor.disconnect()
  src.disconnect()
  stream.getTracks().forEach((track) => track.stop())
  await ctx.close()
  return downsample(concat(chunks), ctx.sampleRate, RATE)
}

async function runChrome(ms: number): Promise<ProbeResult> {
  const rec = acquireSpeechRecognition('es', SPEECH_LOCALES.es)
  if (!rec) return { id: 'chrome', text: '', ms: 0, error: 'no soportado' }
  return new Promise((resolve) => {
    rec.lang = SPEECH_LOCALES.es
    rec.continuous = true
    rec.interimResults = true
    let done = false
    let lastInterimAt = 0
    let finalText = ''
    let lastInterim = ''
    const finish = (error?: string) => {
      if (done) return
      done = true
      try {
        rec.stop()
      } catch (e) {
        logCaughtError('[catch] src/dev/asrLab/AsrLab.tsx', e);
        // ignore
      }
      // Latencia de "cola": último parcial → final (aprox. tras dejar de hablar).
      resolve({
        id: 'chrome',
        text: (finalText || lastInterim).trim(),
        ms: lastInterimAt ? Date.now() - lastInterimAt : 0,
        error,
      })
    }
    rec.onresult = (event: any) => {
      let interim = ''
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (result.isFinal) finalText += result[0].transcript
        else interim += result[0].transcript
      }
      lastInterim = interim || lastInterim
      if (finalText.trim()) finish()
      else lastInterimAt = Date.now()
    }
    rec.onerror = () => finish('error de reconocimiento')
    setTimeout(() => finish(), ms + 2000)
    rec.start()
  })
}

async function runWhisper(modelId: string, pcm: Float32Array): Promise<ProbeResult> {
  const id: ProbeId = modelId.includes('tiny') ? 'whisper-tiny' : 'whisper-base'
  try {
    const mod = await import('../../voice/lib/asr/whisperWasmTranscriber')
    const transcriber = mod.createWhisperWasmTranscriber({ modelId, dtype: 'fp32' })
    await transcriber.preload()
    const started = Date.now()
    const text = await transcriber.transcribe(pcm)
    const ms = Date.now() - started
    transcriber.dispose()
    return { id, text, ms }
  } catch (error) {
        logCaughtError('[catch] src/dev/asrLab/AsrLab.tsx', error);
    return { id, text: '', ms: 0, error: error instanceof Error ? error.message : String(error) }
  }
}

async function runVosk(_pcm: Float32Array): Promise<ProbeResult> {
  // `vosk-browser` 0.0.8 no carga bajo Vite (su worker/WASM no resuelve) y se
  // cuelga. Se marca no soportado para no bloquear el lab. Si se quiere un motor
  // streaming on-device, el mantenido es `sherpa-onnx` (ver plan).
  return { id: 'vosk', text: '', ms: 0, error: 'no soportado (vosk-browser 0.0.8 inestable en Vite)' }
}

function encodeWav16(samples: Float32Array, sampleRate: number): string {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (let i = 0; i < samples.length; i += 1, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/** Google/Gemini vía OpenRouter (online) transcribiendo el audio grabado. */
async function runGemini(pcm: Float32Array): Promise<ProbeResult> {
  try {
    const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY || ''
    if (!apiKey) return { id: 'gemini', text: '', ms: 0, error: 'sin VITE_OPENROUTER_API_KEY' }
    const model =
      import.meta.env.VITE_OPENROUTER_AUDIO_MODEL || 'google/gemini-2.5-flash'
    const data = encodeWav16(pcm, RATE)
    const started = Date.now()
    const res = await fetch(`${OPENROUTER_DEFAULTS.API_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Transcribe exactamente el audio en español. Devuelve solo la transcripción.',
              },
              { type: 'input_audio', input_audio: { data, format: 'wav' } },
            ],
          },
        ],
      }),
    })
    const json: any = await res.json()
    const ms = Date.now() - started
    if (!res.ok) return { id: 'gemini', text: '', ms, error: String(json?.error?.message || res.status) }
    return { id: 'gemini', text: String(json?.choices?.[0]?.message?.content || '').trim(), ms }
  } catch (error) {
        logCaughtError('[catch] src/dev/asrLab/AsrLab.tsx', error);
    return { id: 'gemini', text: '', ms: 0, error: error instanceof Error ? error.message : String(error) }
  }
}

export default function AsrLab() {  const [pcm, setPcm] = useState<Float32Array | null>(null)
  const [results, setResults] = useState<ProbeResult[]>([])
  const [busy, setBusy] = useState('')
  const capturedMs = useMemo(() => (pcm ? Math.round((pcm.length / RATE) * 1000) : 0), [pcm])
  const runningRef = useRef(false)
  const [liveEngine, setLiveEngine] = useState<'chrome' | 'whisper-tiny' | 'whisper-base'>(
    'whisper-tiny',
  )
  const [liveText, setLiveText] = useState('')
  const [liveOn, setLiveOn] = useState(false)
  const liveStopRef = useRef<(() => void) | null>(null)

  const record = useCallback(async (ms: number) => {
    setBusy(`grabando ${ms} ms…`)
    const captured = await capturePcm(ms)
    setPcm(captured)
    setBusy('')
  }, [])

  const push = (result: ProbeResult) => setResults((prev) => [...prev, result])

  const run = useCallback(
    async (id: ProbeId) => {
      if (runningRef.current) return
      runningRef.current = true
      try {
        if (id === 'chrome') {
          setBusy('Chrome SR…')
          push(await runChrome(3000))
        } else if (!pcm) {
          push({ id, text: '', ms: 0, error: 'grabá primero' })
        } else if (id === 'whisper-tiny') {
          setBusy('Whisper tiny…')
          push(await runWhisper('Xenova/whisper-tiny', pcm))
        } else if (id === 'whisper-base') {
          setBusy('Whisper base…')
          push(await runWhisper('Xenova/whisper-base', pcm))
        } else if (id === 'vosk') {
          setBusy('Vosk…')
          push(await runVosk(pcm))
        } else if (id === 'gemini') {
          setBusy('Gemini (Google online)…')
          push(await runGemini(pcm))
        } else {
          push({ id: 'sherpa', text: '', ms: 0, error: 'pendiente de integrar (vendorizar WASM)' })
        }
      } finally {
        setBusy('')
        runningRef.current = false
      }
    },
    [pcm],
  )

  /** Corre TODOS los motores en secuencia sobre la misma grabación. */
  const runAll = useCallback(async () => {
    const order: ProbeId[] = ['whisper-tiny', 'whisper-base', 'gemini', 'vosk', 'chrome']
    for (const id of order) {
      // eslint-disable-next-line no-await-in-loop
      await run(id)
    }
  }, [run])

  const stopLive = useCallback(() => {
    try {
      liveStopRef.current?.()
    } catch (e) {
        logCaughtError('[catch] src/dev/asrLab/AsrLab.tsx', e);
      // ignore
    }
    liveStopRef.current = null
    setLiveOn(false)
  }, [])

  const startLive = useCallback(async () => {
    setLiveText('')
    setLiveOn(true)
    if (liveEngine === 'chrome') {
      const rec = acquireSpeechRecognition('es', SPEECH_LOCALES.es)
      if (!rec) {
        setLiveText('Chrome SR no soportado')
        setLiveOn(false)
        return
      }
      rec.lang = SPEECH_LOCALES.es
      rec.continuous = true
      rec.interimResults = true
      rec.onresult = (event: any) => {
        let text = ''
        for (let i = 0; i < event.results.length; i += 1) text += event.results[i][0].transcript
        setLiveText(text)
      }
      rec.start()
      liveStopRef.current = () => {
        try {
          rec.stop()
        } catch (e) {
        logCaughtError('[catch] src/dev/asrLab/AsrLab.tsx', e);
          // ignore
        }
      }
      return
    }
    // Whisper "en vivo" (bloques): motor real + micrófono continuo.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const AudioCtx = (window.AudioContext || window.webkitAudioContext) as typeof AudioContext
    const ctx = new AudioCtx()
    const modelId = liveEngine === 'whisper-tiny' ? 'Xenova/whisper-tiny' : 'Xenova/whisper-base'
    const tMod: any = await import('../../voice/lib/asr/whisperWasmTranscriber')
    const eMod: any = await import('../../voice/lib/asr/whisperRecognitionEngine')
    const transcriber = tMod.createWhisperWasmTranscriber({ modelId, dtype: 'fp32' })
    const engine: any = eMod.createWhisperRecognitionEngine({ sampleRate: ctx.sampleRate, transcriber })
    engine.onresult = (event: any) => {
      const result = event?.results?.[0]
      setLiveText(String(result?.[0]?.transcript || ''))
    }
    engine.start()
    const src = ctx.createMediaStreamSource(stream)
    const proc = ctx.createScriptProcessor(4096, 1, 1)
    proc.onaudioprocess = (event: any) =>
      engine.pushAudio(event.inputBuffer.getChannelData(0), ctx.sampleRate)
    src.connect(proc)
    proc.connect(ctx.destination)
    liveStopRef.current = () => {
      proc.disconnect()
      src.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      void ctx.close()
      engine.dispose()
    }
  }, [liveEngine])

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', color: '#e6e6e6', background: '#111', minHeight: '100vh' }}>
      <h1>ASR Lab (dev)</h1>
      <p>
        Graba una frase y corre cada motor. Capturado: {capturedMs} ms @ {RATE} Hz.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button onClick={() => record(4000)}>Grabar 4 s</button>
        <button onClick={runAll} disabled={!!busy}>
          Probar todos
        </button>
        {(['whisper-tiny', 'whisper-base', 'vosk', 'sherpa', 'gemini', 'chrome'] as ProbeId[]).map((id) => (
          <button key={id} onClick={() => run(id)} disabled={!!busy}>
            {id}
          </button>
        ))}
        <button onClick={() => setResults([])}>Limpiar</button>
      </div>
      {busy && <p style={{ color: '#ffd479' }}>{busy}</p>}
      <h2>En vivo (conversación)</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <select
          value={liveEngine}
          onChange={(event) => setLiveEngine(event.target.value as typeof liveEngine)}
          disabled={liveOn}
        >
          <option value="whisper-tiny">whisper-tiny</option>
          <option value="whisper-base">whisper-base</option>
          <option value="chrome">chrome</option>
        </select>
        {liveOn ? (
          <button onClick={stopLive}>■ Parar</button>
        ) : (
          <button onClick={startLive}>▶ En vivo</button>
        )}
      </div>
      <p style={{ color: '#8fd', minHeight: 24 }}>{liveText || '(hablá y aparecerá el texto)'}</p>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #444' }}>Motor</th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #444' }}>Latencia</th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #444' }}>Texto</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result, index) => (
            <tr key={index}>
              <td>{result.id}</td>
              <td style={{ textAlign: 'right' }}>{result.ms} ms</td>
              <td>
                {result.error ? <span style={{ color: '#ff6b6b' }}>{result.error}</span> : result.text}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
