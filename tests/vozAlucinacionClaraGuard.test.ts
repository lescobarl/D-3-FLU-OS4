// ============================================================
// vozAlucinacionClaraGuard - B3: solo se descarta la alucinacion CLARA
// ------------------------------------------------------------
// MEDIDO (2026-10-10): `classifyGarbageTranscript` marcaba como BASURA ("garbage: true")
// tres cosas: vacio, ratio alto de tokens sin vocal (`nonword`) y la repeticion adyacente
// de palabra corta (`stutter`). Con `stutter` dominante, `resolveCommittablePhrase`
// devolvia frase VACIA: una locucion con PALABRAS REALES ("se se", "no no", "mas mas")
// se perdia. El dueño lo fija al contrario: solo la alucinacion CLARA (vacio o tokens
// sin palabra) se descarta; toda frase con palabras reales se conserva (con su motivo).
//
// DUENO UNICO: `classifyGarbageTranscript` (.garbage solo para empty/nonword) y
// `resolveCommittablePhrase` (decide commitear o no y SIEMPRE informa el motivo).
// ============================================================
import { describe, expect, it } from 'vitest'
import {
  classifyGarbageTranscript,
  resolveCommittablePhrase,
} from '../src/voice/lib/garbageTranscript.js'

describe('B3 - solo alucinacion clara (empty/nonword)', () => {
  it('una frase con PALABRAS REALES nunca se descarta (aunque el ASR tartamudee)', () => {
    for (const frase of ['se se', 'no no', 'mas mas', 'si si', 'el elote', 'a ver a ver']) {
      const out = resolveCommittablePhrase(frase, '')
      expect(out.phrase, `"${frase}" se perdio`).toBe(frase)
      expect(out.discarded, `"${frase}" no debe descartarse`).toBe(false)
    }
  })

  it('la alucinacion CLARA (vacio / sin palabras) SI se descarta, con su motivo', () => {
    const vacio = resolveCommittablePhrase('', '')
    expect(vacio.phrase).toBe('')
    expect(vacio.discarded).toBe(true)
    expect(vacio.reason).toBe('empty')

    const sinPalabras = resolveCommittablePhrase('zqz qk xz', '')
    expect(sinPalabras.phrase).toBe('')
    expect(sinPalabras.discarded).toBe(true)
    expect(sinPalabras.reason).toBe('nonword')
  })

  it('el veredicto distingue alucinacion clara de tartamudeo con palabras reales', () => {
    expect(classifyGarbageTranscript('').garbage).toBe(true)
    expect(classifyGarbageTranscript('zqz qk xz').garbage).toBe(true)
    const tartamudeo = classifyGarbageTranscript('se se')
    expect(tartamudeo.garbage, 'stutter NO es alucinacion clara').toBe(false)
    expect(tartamudeo.reason).toBe('stutter')
    expect(classifyGarbageTranscript('el elote').garbage).toBe(false)
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): el motivo discrimina', () => {
    const out = resolveCommittablePhrase('zqz qk xz', '')
    expect(out.discarded).toBe(true)
    expect(out.reason).not.toBe('stutter')
    const real = resolveCommittablePhrase('no no', '')
    expect(real.discarded).toBe(false)
    // El motivo (tartamudeo) viaja para el log, pero NO descarta la locucion.
    expect(real.reason).toBe('stutter')
  })
})
