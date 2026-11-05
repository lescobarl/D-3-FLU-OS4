// ============================================================
// vozFirmaDeFilaGuard - el NOMBRE alcanza TODAS las filas de esa VOZ (por TIMBRE).
// ------------------------------------------------------------
// MEDIDO por el dueno (2026-10-11) y RE-CERRADO con su mandato del 2026-10-13: la etiqueta
// ("Hablante N") es provisional y puede CAMBIAR para la misma persona; la VOZ (su vector) no.
// El vinculo de la fila con su voz NO puede ser la etiqueta: tiene que ser el TIMBRE.
//
// MECANISMO (una sola via, corte 2026-10-30 problema 6): el MODULO mide la voz y GUARDA la
// firma en su fila (cierre.ts -> fila.ts -> `row.committed`). El UNICO escritor de la vista
// (`conversationMotorProducto.js`) sella `signature` en la entrada y calcula la clave de voz
// por TIMBRE (`voiceKeyFor` -> `resolveVoiceIdentity` -> coseno del dueno unico
// `compareCosineSignatures`, con el piso unico `sameVoiceFloor`). Dos etiquetas del MISMO
// timbre dan la MISMA clave y, por tanto, el MISMO nombre al mostrarse. Ninguna fila se
// reescribe: el escritor pasivo (pasivo.ts) y App quedaron RETIRADOS con la ruta doble.
//
// PRUEBA DE DETECTOR: un escritor que vincule la fila SOLO por etiqueta se marca infractor.
// ============================================================
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Corte 2026-10-30: el escritor pasivo se retiró con la ruta doble (problema 6). La fila la
// escribe el módulo y la clave por TIMBRE la aporta el ÚNICO escritor de la vista:
// `conversationMotorProducto.js` (`voiceKeyFor` con la firma que trae la fila del módulo).
const ESCRITOR = readFileSync('src/voice/compose/conversationMotorProducto.js', 'utf8')
const FILA = readFileSync('src/voice/conversation/fila.ts', 'utf8')
const CIERRE = readFileSync('src/voice/conversation/cierre.ts', 'utf8')
const DIRECTORY = readFileSync('src/voice/lib/speakerDirectory.js', 'utf8')
const CORE = readFileSync('src/voice/lib/speakerCore.js', 'utf8')

/** true si el escritor vincula la VOZ por TIMBRE: `voiceKeyFor` con `signature` en su argumento. */
export function vinculaPorTimbre(src: string): boolean {
  return /voiceKeyFor\(\{[^}]*signature\s*:/.test(src)
}

describe('el vinculo de la fila con su VOZ es por TIMBRE', () => {
  it('el escritor calcula la clave de voz por TIMBRE', () => {
    expect(vinculaPorTimbre(ESCRITOR), 'sin timbre, dos etiquetas de la misma persona no se ven con su nombre').toBe(true)
  })

  it('el criterio de "misma voz" por timbre tiene UN dueno', () => {
    expect(DIRECTORY, 'el emparejamiento por timbre vive en el directorio').toContain('compareCosineSignatures')
    expect((CORE.match(/export function compareCosineSignatures/g) || []).length, 'un solo coseno').toBe(1)
  })

  it('la fila GUARDA su firma y el modulo la aporta (la medida del turno)', () => {
    expect(FILA, 'construirFila sella la firma en la fila del modulo').toContain('firma: entrada.firma')
    expect(CIERRE, 'el cierre aporta la medida: el vector de la plantilla de la voz que cierra').toContain('plantillasVoz.get(vozIdFirma)?.vector')
    expect(ESCRITOR, 'el escritor sella la firma en la entrada de la vista').toContain('signature: firma')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): el vinculo SOLO por etiqueta se marca', () => {
    const viejo = 'const vozDeLaFila = labelToSpeakerId(resolved)'
    expect(vinculaPorTimbre(viejo), 'vincular solo por etiqueta no basta').toBe(false)
    // `voiceKeyFor` SIN firma en su argumento tampoco vincula por timbre.
    const sinFirma = 'voiceKeyFor({ voiceId: labelToSpeakerId(resolved) })'
    expect(vinculaPorTimbre(sinFirma), 'sin firma no hay consulta por timbre').toBe(false)
    expect(vinculaPorTimbre(ESCRITOR)).toBe(true)
  })
})
