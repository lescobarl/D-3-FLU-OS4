// ============================================================
// Guard: la sesion tiene NOMBRE REGISTRADO y su voz manda sobre la etiqueta generica.
// ------------------------------------------------------------
// DEFECTO MEDIDO (debug.log del dueno, 2026-10-07 21:08-21:11 UTC):
//   El dueno dijo "Okay flu Soy Luis" (preflight turn=8 name="luis" a las 21:09:30) y, EN EL
//   MISMO SEGUNDO, los siguientes turnos volvieron a "Hablante 2": `Match reason=prefer-cluster-match
//   sim=0.982 name="Hablante 2"`. Habia un cluster 'luis', pero la `prefer` (la etiqueta "pegajosa"
//   = ultimo hablante) se evalua ANTES y ganaba. El nombre registrado nunca se aplicaba.
// Dos causas:
//   A) el cliente calculaba `sessionPrimary`/`preferSpeaker` y los TIRABA: no los enviaba al worker,
//      asi que el worker preferia `lastSpeaker` (una etiqueta generica). Se reenvia `sessionPrimary`.
//   B) la compuerta de `prefer` era `floor` (0.85). Para un NOMBRE PROPIO la compuerta es la de
//      identidad registrada (cosineRegisteredMatchThreshold); con 0.85 una misma voz (0.70-0.79)
//      no entraba y el nombre se perdia.
// ============================================================
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assignSpeaker } from '../src/voice/lib/speakerCore.js'

const CLIENT = resolve(process.cwd(), 'src/voice/lib/voiceIdWorkerClient.js')

describe('A) el cliente envia el hablante PRIMARIO (nombre registrado) al worker', () => {
  it('el payload del worker lleva preferSpeaker derivado de sessionPrimary', () => {
    const src = readFileSync(CLIENT, 'utf8')
    const ok = /preferSpeaker:\s*matchPayload\.sessionPrimary/.test(src)
    expect(ok, 'voiceIdWorkerClient.js debe reenviar sessionPrimary como preferSpeaker; si no, el worker prefiere la etiqueta generica (lastSpeaker)').toBe(true)
  })
})

// Voz que puntua ~0.83 con el nombre registrado 'luis' y ~0.90 con la etiqueta pegajosa
// 'Hablante 2' (clusters casi paralelos: es la MISMA persona, caso real del log).
const LUIS = [0.866, 0.5, 0]
const H2 = [0, 1, 0]
const ANG = 0.451 // 25.84 grados
const V = [Math.sin(ANG), Math.cos(ANG), 0]
const BASE = {
  clusters: [{ label: 'luis', signature: LUIS }, { label: 'Hablante 2', signature: H2 }],
  lastSpeaker: 'Hablante 2',
  lastSignature: H2,
  reservedLabels: [],
}

describe('B) con el nombre registrado como prefer, la misma voz se rotula con su NOMBRE', () => {
  it('prefer = "luis" (0.83 de similitud, bajo la compuerta generica 0.85) devuelve "luis"', () => {
    const out = assignSpeaker(V, { ...BASE, preferLabel: 'luis' } as any)
    expect(out.speakerName, `resolvio "${out.speakerName}" (${out.reason})`).toBe('luis')
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('con la etiqueta pegajosa "Hablante 2" como prefer, la MISMA voz conserva la etiqueta generica', () => {
    // Es lo que pasaba antes de reenviar el primario: el worker preferia lastSpeaker.
    const out = assignSpeaker(V, { ...BASE, preferLabel: 'Hablante 2' } as any)
    expect(out.speakerName, `resolvio "${out.speakerName}" (${out.reason})`).toBe('Hablante 2')
  })
})
