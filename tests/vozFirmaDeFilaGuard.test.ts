// ============================================================
// vozFirmaDeFilaGuard - el NOMBRE alcanza TODAS las filas de esa VOZ (por TIMBRE).
// ------------------------------------------------------------
// MEDIDO por el dueno (2026-10-11) y RE-CERRADO con su mandato del 2026-10-13: la etiqueta
// ("Hablante N") es provisional y puede CAMBIAR para la misma persona; la VOZ (su vector) no.
// El vinculo de la fila con su voz NO puede ser la etiqueta: tiene que ser el TIMBRE.
//
// MECANISMO (una sola via): al escribir la fila se calcula su CLAVE DE VOZ por TIMBRE
// (`voiceKeyFor` -> `matchDirectoryVoice` -> coseno del dueno unico `compareCosineSignatures`,
// con el piso unico `sameVoiceFloor`). Dos etiquetas del MISMO timbre dan la MISMA clave y,
// por tanto, el MISMO nombre al mostrarse. Ninguna fila se reescribe.
//
// PRUEBA DE DETECTOR: un escritor que vincule la fila SOLO por etiqueta se marca infractor.
// ============================================================
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Corte 2026-10-26: conversationTurnRow.ts se retiró con la tubería vieja. La fila la
// escribe el módulo (pasivo.ts guarda `signature: firma`) y la clave por TIMBRE la
// aporta el adaptador del módulo (adapters.ts `claveVoz` -> `voiceKeyFor`).
const ROW = readFileSync('src/voice/conversation/pasivo.ts', 'utf8')
const ADAPTADORES = readFileSync('src/voice/conversation/adapters.ts', 'utf8')
const DIRECTORY = readFileSync('src/voice/lib/speakerDirectory.js', 'utf8')
const CORE = readFileSync('src/voice/lib/speakerCore.js', 'utf8')
const APP = readFileSync('src/App.tsx', 'utf8')

/** true si el escritor de la fila vincula la VOZ por TIMBRE (y no solo por etiqueta). */
export function vinculaPorTimbre(src: string): boolean {
  return /voiceKeyFor\(\{\s*voiceId:\s*datos\.voiceId,\s*signature\s*:/.test(src)
}

describe('el vinculo de la fila con su VOZ es por TIMBRE', () => {
  it('el escritor calcula la clave de voz por TIMBRE', () => {
    expect(vinculaPorTimbre(ADAPTADORES), 'sin timbre, dos etiquetas de la misma persona no se ven con su nombre').toBe(true)
  })

  it('el criterio de "misma voz" por timbre tiene UN dueno', () => {
    expect(DIRECTORY, 'el emparejamiento por timbre vive en el directorio').toContain('compareCosineSignatures')
    expect((CORE.match(/export function compareCosineSignatures/g) || []).length, 'un solo coseno').toBe(1)
  })

  it('la fila GUARDA su firma y App la aporta (la medida del turno)', () => {
    expect(ROW, 'la fila guarda su firma').toContain('signature: firma')
    expect(APP, 'App pasa la firma del turno').toContain('signature: (resolved as { signature?: number[] | null })?.signature ?? null')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): el vinculo SOLO por etiqueta se marca', () => {
    const viejo = 'const vozDeLaFila = labelToSpeakerId(resolved)'
    expect(vinculaPorTimbre(viejo), 'vincular solo por etiqueta no basta').toBe(false)
    expect(vinculaPorTimbre(ADAPTADORES)).toBe(true)
  })
})
