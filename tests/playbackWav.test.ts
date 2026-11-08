// @vitest-environment node
// ============================================================
// FLU Playback - WAV de reproduccion
// ------------------------------------------------------------
// El unico cambio que el playback hace al audio es anadir silencio inicial y
// final. Este test fija ese contrato sobre la grabacion real del fixture.
// ============================================================
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPlaybackWav, loadSession, readWavInfo } from '../scripts/playback/session.mjs'

const SESSION_DIR = join(process.cwd(), 'tests/fixtures/playback/mini')
const cleanups: string[] = []

afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('FLU Playback - WAV de reproduccion', () => {
  it('anade silencio inicial/final sin alterar el audio grabado', () => {
    const session = loadSession(SESSION_DIR)
    const wav = buildPlaybackWav(session, { leadInMs: 1000, tailMs: 500 })
    cleanups.push(wav.dir)

    const info = readWavInfo(wav.path)
    expect(info.sampleRate).toBe(session.audio.sampleRate)
    expect(info.channels).toBe(session.audio.channels)
    expect(info.bitsPerSample).toBe(16)
    expect(info.seconds).toBeCloseTo(session.audio.seconds + 1.5, 3)

    const source = readFileSync(session.audioPath)
    const sourcePcm = source.subarray(session.audio.dataOffset, session.audio.dataOffset + session.audio.dataBytes)
    const out = readFileSync(wav.path)
    const leadBytes = Math.round(info.sampleRate * 1) * info.channels * 2
    const tailBytes = Math.round(info.sampleRate * 0.5) * info.channels * 2
    const copied = out.subarray(info.dataOffset + leadBytes, info.dataOffset + leadBytes + sourcePcm.length)
    expect(copied.equals(sourcePcm)).toBe(true)
    expect(out.subarray(info.dataOffset, info.dataOffset + leadBytes).every((b) => b === 0)).toBe(true)
    expect(out.subarray(out.length - tailBytes).every((b) => b === 0)).toBe(true)
  })
})
