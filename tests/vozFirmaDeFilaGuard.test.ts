// ============================================================
// vozFirmaDeFilaGuard - la sustitucion del nombre alcanza TODAS las filas de esa voz.
// ------------------------------------------------------------
// MEDIDO por el dueno (2026-10-11 01:21:57): al registrar el nombre solo se renombro la
// etiqueta de ese turno; las filas con etiquetas YA EXTINTAS ("Hablante 1") y la del
// participante ("luis") se quedaron. La sustitucion tiene que vincular la fila por su FIRMA
// (la voz del turno), no por su etiqueta.
// PRUEBA DE DETECTOR: el texto sin el vinculo por firma se marca infractor.
// ============================================================
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ROW = readFileSync('src/voice/lib/conversationTurnRow.ts', 'utf8')
const POLICY = readFileSync('src/voice/lib/speakerClusters.js', 'utf8')
const APP = readFileSync('src/App.tsx', 'utf8')

/** true si el renombre vincula la fila por FIRMA (y no solo por etiqueta). */
export function renombraPorFirma(src: string): boolean {
  return /sameVoiceBySignature\(compareCosineSignatures\(ancla/.test(src)
}

describe('sustitucion por FIRMA de la fila', () => {
  it('el renombre usa la FIRMA de la fila ademas de la etiqueta', () => {
    expect(renombraPorFirma(ROW), 'sin firma, las etiquetas extintas no se renombran').toBe(true)
  })
  it('el criterio de "misma voz" por firma tiene UN dueno', () => {
    expect(POLICY).toContain('export function sameVoiceBySignature')
    expect((POLICY.match(/export function sameVoice\w*BySignature/g) || []).length, 'un solo criterio').toBe(1)
  })
  it('el escritor GUARDA la firma y App la aporta', () => {
    expect(ROW, 'la fila guarda su firma').toContain('signature: normalizeRowSignature(signature)')
    expect(APP, 'App pasa la firma del turno').toContain('signature: (resolved as { signature?: number[] | null })?.signature ?? null')
  })
  it('PRUEBA DE DETECTOR (el detector no es decorativo): sin el vinculo por firma se marca', () => {
    const viejo = 'const porEtiqueta = normalized.has(foldSpeakerKey(current))'
    expect(renombraPorFirma(viejo), 'el renombre viejo no miraba la firma').toBe(false)
    expect(renombraPorFirma(ROW)).toBe(true)
  })
})
