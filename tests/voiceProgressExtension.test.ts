/**
 * voiceProgressExtension — Invariante anti-fragmentación (§9): ÚNICA FUENTE DE
 * VERDAD del texto de un turno. Finales e interims NO deciden por separado:
 * ambos usan `resolveIngressCaptureText`.
 *
 * Nace ROJO (§10.2) estructuralmente mientras haya 2 caminos decidiendo el
 * texto. El log real mostró el residuo "tas de cafe" por esa divergencia
 * (final path con guard progresivo, interim path sin él).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isProgressiveExtension, resolveIngressCaptureText } from '../src/voice/lib/conversationStream'

const ROOT = process.cwd()
const INGRESS = join(ROOT, 'src', 'voice', 'lib', 'transcriptIngress.js')

describe('voiceProgressExtension — única fuente del texto de turno (§9)', () => {
  it('reconoce la extensión progresiva del caso real del log', () => {
    expect(
      isProgressiveExtension('busca en la web recetas de cafe', 'busca en la web rece'),
    ).toBe(true)
    expect(isProgressiveExtension('busca en la web recetas', 'cuéntame la capital')).toBe(false)
  })

  it('resuelve el texto sin inventar residuos', () => {
    // Emisión que crece: se conserva completa (no "tas de cafe").
    expect(resolveIngressCaptureText('busca en la web recetas de cafe', 'busca en la web rece')).toBe(
      'busca en la web recetas de cafe',
    )
    // Sin fila previa: texto tal cual.
    expect(resolveIngressCaptureText('hola qué tal', '')).toBe('hola qué tal')
  })

  it('transcriptIngress usa la MISMA función en finales e interims', () => {
    const src = readFileSync(INGRESS, 'utf8')
    const uses = (src.match(/resolveIngressCaptureText/g) || []).length
    expect(
      uses,
      `transcriptIngress debe decidir el texto en UN solo lugar (finales + interims); usos=${uses}`,
    ).toBeGreaterThanOrEqual(2)
    // No debe re-derivar el criterio de "emisión que crece" por su cuenta.
    expect(
      src.includes('isProgressiveExtension'),
      'transcriptIngress debe usar isProgressiveExtension, no re-derivar startsWith',
    ).toBe(true)
    expect(
      /cleanedInterim\.toLowerCase\(\)\.startsWith\(lastCommitted/.test(src),
      'transcriptIngress no debe re-derivar la extensión con startsWith propio',
    ).toBe(false)
  })
})
