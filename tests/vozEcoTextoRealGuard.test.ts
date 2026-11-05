// ============================================================
// vozEcoTextoRealGuard - B2: el eco se mide contra el texto REAL de FLU, con COBERTURA
// y con la ventana anclada al FIN de su habla.
// ------------------------------------------------------------
// MEDIDO (2026-10-10, con las funciones reales):
//   peelWakeQuestionEcho('el elote y el maiz', ['te cuento sobre el elote']) -> 'y el maiz'
//   peelWakeQuestionEcho('te cuento sobre el elote', [...])                  -> 'elote'
// El peel quitaba del principio de la locucion CUALQUIER trozo de 1..8 palabras igual a la
// CABEZA o la COLA de la fuente, sin cobertura ni ventana: una locucion real que repetia
// palabras de lo ultimo dicho se TRUNCABA (se perdia contenido y la fila salia cortada).
// Y la fuente NO era el texto de FLU: `wakeTurnCommit` pasaba `lastCommitted`, que es la
// ultima fila del LOG DE USUARIO (`logRowsTextRef` = userRowsTextView).
//
// REGLA B2 (dueno unico: `src/voice/lib/echoPolicy.js`):
//   - la fuente es la ULTIMA fila de FLU (su texto real), no la del usuario;
//   - la ventana se ancla al FIN de su habla (`timestamp` ms de la fila de FLU);
//   - solo se recorta si el trozo CUBRE al menos `echoCoverageFloor` de la fuente
//     (un eco de verdad repite CASI TODO lo anterior; repetir su cola es habla nueva).
// ============================================================
import { describe, expect, it } from 'vitest'
import {
  echoCoverageFloor,
  echoWindowMs,
  isEchoWindowOpen,
  resolveEchoSources,
  resolveFluEchoSource,
} from '../src/voice/lib/echoPolicy.js'
import { peelWakeQuestionEcho } from '../src/voice/lib/audioMath.js'
import { useIntegrationStore } from '../src/store/integrationStore'

const FLU = 'te cuento sobre el elote'

function conFilaDeFlu(text: string, ageMs: number) {
  useIntegrationStore.setState({
    conversationHistory: [
      { id: 'u1', role: 'user', text: 'y eso?', speakerName: 'Luz', timestamp: Date.now() - ageMs - 500 },
      { id: 'f1', role: 'flu', text, timestamp: Date.now() - ageMs },
    ] as never,
  })
}

describe('B2 - eco contra el texto REAL de FLU, con cobertura y ventana', () => {
  it('una locucion real que repite palabras de la frase anterior de FLU SE ESCRIBE entera', () => {
    conFilaDeFlu(FLU, 500)
    const sources = resolveEchoSources({ passiveText: '' })
    expect(sources, 'la fuente es el texto REAL de FLU').toEqual([FLU])
    expect(peelWakeQuestionEcho('el elote y el maiz', sources)).toBe('el elote y el maiz')
  })

  it('un ECO de verdad (repite casi todo lo que dijo FLU) si se recorta', () => {
    const sources = [FLU]
    expect(peelWakeQuestionEcho('te cuento sobre el elote y ya', sources)).toBe('y ya')
  })

  it('la ventana se ancla al FIN del habla de FLU: vieja, no se usa como eco', () => {
    conFilaDeFlu(FLU, echoWindowMs() + 1)
    expect(isEchoWindowOpen(echoWindowMs() + 1)).toBe(false)
    expect(resolveEchoSources({ passiveText: '' })).toEqual([])
    conFilaDeFlu(FLU, 100)
    expect(resolveEchoSources({ passiveText: '' })).toEqual([FLU])
  })

  it('el texto pasivo de la MISMA locucion (eco de TV) sigue funcionando', () => {
    expect(resolveEchoSources({ passiveText: 'primeros partidos' })).toContain('primeros partidos')
    expect(peelWakeQuestionEcho('primeros partidos platicame de los autos', ['primeros partidos'])).toBe(
      'platicame de los autos',
    )
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): con cobertura 0, la cola tambien se recorta', () => {
    expect(echoCoverageFloor()).toBeGreaterThan(0.5)
    const flojo = peelWakeQuestionEcho('el elote y el maiz', [FLU], { coverageFloor: 0 })
    expect(flojo).toBe('y el maiz')
    expect(resolveFluEchoSource({ now: () => Date.now() }).text).toBe(FLU)
  })
})
