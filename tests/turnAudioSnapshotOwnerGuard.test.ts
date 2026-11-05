// ============================================================
// turnAudioSnapshotOwnerGuard.test.ts — Guard de PROPIEDAD del audio del turno
// ------------------------------------------------------------
// Invariante: la diarización debe consumir el SNAPSHOT de audio del turno
// (capturado por su dueño único antes de que el buffer PCM se vacíe), NO el
// buffer vivo, que puede haber quedado a 0 por un cierre/commit intermedio.
//
// Medido en la sesión real del dueño (2026-10-06, debug.log): 24 de 25 turnos con
// `SpeakerTrace snap=0` y un único embedding calculado → toda la sesión caía a
// "Hablante 1". El audio existía en el buffer, pero se leía DESPUÉS de vaciarlo.
//
// CORTE 2026-10-26: el arnés de resolución (`createTurnSpeakerAudioResolver`,
// turnSpeakerPreflight.js, isla retirada con la tubería vieja) se sustituye por
// el dueño VIVO `turnAudioSnapshot.js` (semántica pura) y por el guard de fuente
// del camino vivo en `useFluVoiceAssistant.js`: la firma se calcula SOLO del
// snapshot (`selectVoicedWindow(audioSnapshot)`), sin snapshot no se mide, y la
// diarización consume `turnAudioForDiarize` (snapshot primero, chunks SOLO como
// respaldo mientras el turno sigue activo).
// ============================================================
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  captureTurnAudioSnapshot,
  capturedTurnAudio,
} from '../src/voice/lib/turnAudioSnapshot.js'

const HOOK = 'src/voice/hooks/useFluVoiceAssistant.js'

/** Fuente del camino vivo (una vez por corrida). */
function hookSource(): string {
  return readFileSync(join(process.cwd(), HOOK), 'utf8')
}

/**
 * Detector de la mutación: cada `selectVoicedWindow(` del camino vivo debe
 * alimentarse del SNAPSHOT; alimentarlo del buffer vivo (chunks) es la forma
 * del defecto original. Devuelve las líneas infractoras.
 */
export function findLiveBufferFeeds(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /selectVoicedWindow\(/.test(line) && !/selectVoicedWindow\(audioSnapshot/.test(line))
    .map(({ index }) => `${HOOK}:${index + 1}`)
}

describe('diarización — el audio del turno lo captura su dueño único (semántica pura)', () => {
  it('captura por turno: el turno sellado lee SU snapshot (no el del turno activo)', () => {
    captureTurnAudioSnapshot(1, { buildWindow: () => new Float32Array([1, 2, 3]) })
    const audio = capturedTurnAudio(1, 2)
    expect(audio).not.toBeNull()
    expect(audio!.length).toBe(3)
  })

  it('una captura con MAS VOZ mejora el slot; una vacía o con menos voz NO pisa', () => {
    captureTurnAudioSnapshot(4, { buildWindow: () => new Float32Array([0.1, 0.2]), meta: { sampleRate: 16000 } })
    // Más voz: la ventana nueva reemplaza a la corta.
    const mejor = captureTurnAudioSnapshot(4, {
      buildWindow: () => new Float32Array([0.1, 0.2, 0.3, 0.4]),
      meta: { sampleRate: 16000 },
    })
    expect(mejor.length).toBe(4)
    // Captura vacía después de una buena: la buena se conserva (write-once invertido).
    captureTurnAudioSnapshot(4, { buildWindow: () => new Float32Array(0), meta: { sampleRate: 16000 } })
    expect(capturedTurnAudio(4, 9)!.length).toBe(4)
  })

  it('turno ACTIVO sin snapshot => null (aun no capturado: el resolver usa la ventana del turno)', () => {
    expect(capturedTurnAudio(5, 5)).toBeNull()
  })

  it('turno SELLADO sin snapshot => vacío: NUNCA el buffer vivo de otro turno', () => {
    // MEDIDO (log del dueño 2026-10-18): el preflight tardío del turno 11 leyó 10.088 /
    // 18.509 ms del buffer vivo (audio de otros turnos + eco del TTS) y creó un
    // "Hablante 2" con similitud 0.091. Un turno sellado sin SU audio no se mide.
    const audio = capturedTurnAudio(6, 7)
    expect(audio).not.toBeNull()
    expect(audio!.length).toBe(0)
  })

  it('la retención es ACOTADA: el turno más viejo sale del mapa (sin fuga)', () => {
    for (let i = 100; i < 117; i += 1) {
      captureTurnAudioSnapshot(i, { buildWindow: () => new Float32Array([1]) })
    }
    // 16 slots: el turno 100 ya no está; el último sí.
    expect(capturedTurnAudio(100, 999)!.length).toBe(0)
    expect(capturedTurnAudio(116, 999)!.length).toBe(1)
  })
})

describe('el camino vivo consume el snapshot del dueño (guard de fuente)', () => {
  it('el hook importa al dueño y la firma se calcula SOLO del snapshot', () => {
    const source = hookSource()
    expect(source).toContain("from '../lib/turnAudioSnapshot.js'")
    expect(source).toContain('selectVoicedWindow(audioSnapshot')
    expect(source, 'la firma jamas se alimenta del buffer vivo').toContain('audioSnapshot?.length')
    expect(source, 'sin snapshot no hay medida').toContain('if (!audioSnapshot.length)')
    expect(source, 'la diarizacion pasa por el dueno (snapshot primero, chunks como respaldo)').toContain('turnAudioForDiarize(activeTurnIdRef.current')
  })

  it('PRUEBA DE DETECTOR: alimentar el buffer vivo a la firma se marca', () => {
    const legitimo = hookSource()
    expect(findLiveBufferFeeds(legitimo)).toEqual([])
    const infractor = legitimo.replace('selectVoicedWindow(audioSnapshot', 'selectVoicedWindow(chunksRef.current')
    expect(findLiveBufferFeeds(infractor)).not.toEqual([])
  })
})
