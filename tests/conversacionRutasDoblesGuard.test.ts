/**
 * conversacionRutasDoblesGuard — barrera medida de las rutas dobles del módulo
 * CONVERSACIÓN.
 *
 * Mide el estado REAL de `src/voice/conversation` y lo contrasta con la línea
 * base versionada (`scripts/conversacion-rutas-dobles-baseline.json`):
 *
 *  - UN solo tiempo: ningún literal 5000/3500/12000; UNA lectura de
 *    `getTranscriptPauseCfg().srGapCommitMs` (ports.ts).
 * - UNA sola condición de cierre: solo `frontera.ts` compara silencio y
 *   decide la causa 'voz'. `texto.ts` no cierra por texto ni lee la medida
 *   vieja (`ultimaMedida`) y `ingesta.ts` tampoco la conserva.
 * - La voz la mide el módulo (`verificarCambioVoz`) sobre el tramo ENTRANTE,
 *   aunque el VAD lo haya cortado a otro tramo, y se verifica ANTES de la
 *   atribución del texto.
 *  - El final se compone desde 0 (hipótesis completa), no con `resultIndex`.
 *  - No se descarta por prefijo de texto (`previo.includes(nuevo)`).
 *
 * La línea base solo BAJA: si una métrica baja, se actualiza en el mismo
 * cambio; si sube, este guard falla.
 */
// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type Fuente = Readonly<{ nombre: string; src: string }>

const DIRECTORIO = join(process.cwd(), 'src/voice/conversation')
const BASELINE = JSON.parse(
  readFileSync(join(process.cwd(), 'scripts/conversacion-rutas-dobles-baseline.json'), 'utf8'),
) as { metricas: Record<string, number> }

const FUENTES: readonly Fuente[] = readdirSync(DIRECTORIO)
  .filter((nombre) => nombre.endsWith('.ts'))
  .map((nombre) => ({
    nombre,
    src: readFileSync(join(DIRECTORIO, nombre), 'utf8'),
  }))

const fuente = (nombre: string): string =>
  FUENTES.find((archivo) => archivo.nombre === nombre)?.src ?? ''

const contar = (src: string, patron: RegExp): number =>
  (src.match(new RegExp(patron.source, patron.flags.includes('g') ? patron.flags : `${patron.flags}g`)) ?? [])
    .length

function medir() {
  return {
    timeLiterals: FUENTES.reduce(
      (total, archivo) => total + contar(archivo.src, /\b(?:5000|3500|12000)\b/g),
      0,
    ),
    timeConfigReads: FUENTES.filter((archivo) =>
      /getTranscriptPauseCfg/.test(archivo.src),
    ).length,
    closureConditionOwners: FUENTES.filter((archivo) =>
      /silencioMs\s*>=\s*(?:umbrales\.)?silenceCloseMs/.test(archivo.src),
    ).length,
    finalResultIndex: contar(
      fuente('producto.ts'),
      /componerFraseDelEvento\(\s*evento\.results,\s*evento\.resultIndex\s*\)/g,
    ),
    staleMeasureReads: FUENTES.reduce(
      (total, archivo) => total + contar(archivo.src, /ultimaMedida/g),
      0,
    ),
    voiceChangeSameTramoOnly: contar(
      fuente('ingesta.ts'),
      /abierta\.locutionId\s*!==\s*tramoId\s*\)\s*return null/g,
    ),
    finalWholeLineReplace: contar(fuente('cierre.ts'), /texto:\s*textoFinal/g),
    broadTextDedupe: contar(fuente('ingesta.ts'), /previo\.includes\(nuevo\)/g),
  }
}

describe('CONVERSACIÓN — rutas dobles medidas', () => {
  it('las métricas reales son EXACTAMENTE la línea base (solo baja)', () => {
    expect(medir()).toEqual(BASELINE.metricas)
  })

  it('el tiempo tiene UN dueño consumido, no una copia literal', () => {
    expect(fuente('ports.ts')).toContain('getTranscriptPauseCfg')
    expect(fuente('ports.ts')).toContain('srGapCommitMs')
    expect(
      FUENTES.filter((archivo) => /getTranscriptPauseCfg/.test(archivo.src)).map(
        (archivo) => archivo.nombre,
      ),
    ).toEqual(['ports.ts'])
  })

  it('la condición de cierre vive solo en frontera.ts', () => {
    expect(fuente('frontera.ts')).toContain("causa: 'voz'")
    expect(fuente('frontera.ts')).toContain('cambioVoz')
    expect(
      FUENTES.filter((archivo) =>
        /silencioMs\s*>=\s*(?:umbrales\.)?silenceCloseMs/.test(archivo.src),
      ).map((archivo) => archivo.nombre),
    ).toEqual(['frontera.ts'])
    expect(fuente('texto.ts')).not.toContain('silencioCierra')
    expect(fuente('texto.ts')).not.toMatch(/cerrarLocucion\([^)]*'voz'/)
  })

  it('la voz la mide el módulo sobre el tramo entrante ANTES de la atribución', () => {
    expect(fuente('ingesta.ts')).toContain('function verificarCambioVoz')
    expect(fuente('ingesta.ts')).toContain('function partirLocucionPorCambioDeVoz')
    expect(fuente('ingesta.ts')).toContain('continuaLaFrase')
    // El tramo entrante se mide aunque NO sea el de la locución abierta.
    expect(fuente('ingesta.ts')).toContain('tramos.muestras(tramoId, entrante)')
    // El piso de continuidad viene de config y existe un solo literal de voz.
    expect(fuente('ingesta.ts')).toContain('umbralExistenteVoz')
    // El texto se atribuye DESPUÉS de verificar la voz del tramo entrante.
    expect(fuente('ingesta.ts')).toMatch(
      /verificarCambioVoz\(tramoOrigen\)[\s\S]*tramoDestinoDeTexto\(/,
    )
  })

  it('el final sustituye solo el texto de SU tramo, no la línea completa', () => {
    expect(fuente('cierre.ts')).toContain('textoTramos')
    expect(fuente('cierre.ts')).not.toMatch(/texto:\s*textoFinal/)
  })

  it('el final usa la hipótesis completa desde 0, no resultIndex', () => {
    expect(fuente('producto.ts')).toContain('hayFinal ? 0 : evento.resultIndex')
    expect(fuente('producto.ts')).not.toMatch(
      /componerFraseDelEvento\(\s*evento\.results,\s*evento\.resultIndex\s*\)/,
    )
  })
})
