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

/** transcriptIngress usa la MISMA funcion en finales e interims (mismo criterio del guard). */
export function ingressReusesSingleTextFn(src: string): boolean {
  const uses = (src.match(/resolveIngressCaptureText/g) || []).length
  return uses >= 2 && src.includes('isProgressiveExtension') && !/cleanedInterim\.toLowerCase\(\)\.startsWith\(lastCommitted/.test(src)
}

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
        expect(ingressReusesSingleTextFn(readFileSync(INGRESS, 'utf8'))).toBe(true)
  })
})

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('voiceProgressExtension - el detector no es decorativo', () => {
  it('marca el fuente que re-deriva el criterio y no el que usa la fuente unica', () => {
    const bueno = 'resolveIngressCaptureText(a, b)\nresolveIngressCaptureText(c, d)\nisProgressiveExtension(x, y)'
    expect(ingressReusesSingleTextFn(bueno)).toBe(true)
    const malo = bueno + "\nconst e = cleanedInterim.toLowerCase().startsWith(lastCommitted)"
    expect(ingressReusesSingleTextFn(malo)).toBe(false)
    expect(ingressReusesSingleTextFn('const a = 1')).toBe(false)
  })
})