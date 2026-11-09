/**
 * onboardingCierreHablaGuard — el onboarding que completa por NOMBRE CONOCIDO también habla.
 *
 * Reporte del dueño (2026-11-09): «terminaba el onboarding y decía ¡qué bonito nombre!, y ya
 * no lo dice» y «tampoco dice que la conversación está lista». Causa: el atajo de los perfiles
 * existentes (`completeWithName`) marcaba el onboarding completado **sin hablar**, porque no
 * pasa por `advanceOnboarding`. El texto y su composición NUNCA se perdieron (siguen en
 * `FLU_CONFIG.onboarding` y en `onboardingFlow`); lo que faltaba era la VOZ de ese atajo.
 *
 * Mide el dueño REAL (`completedNameSpeech`) con la config REAL del producto.
 * @revisor CREAR NUEVO — guard del habla del onboarding; no añade lógica de producto.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { completedNameSpeech } from '../src/core/onboarding/onboardingFlow'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const STEPS = (FLU_CONFIG.onboarding?.steps || []) as never[]

describe('onboarding — completar con nombre conocido HABLA', () => {
  it('saluda con el nombre y dice el cierre (config real del producto)', () => {
    const frase = completedNameSpeech(STEPS, 'Luis', 'es')
    expect(STEPS.length).toBeGreaterThan(2)
    expect(frase).toContain('Luis')
    expect(frase.toLowerCase()).toContain('bonito nombre')
    // El cierre es una frase MÁS: el saludo solo no basta.
    expect(frase.length).toBeGreaterThan('¡Luis, qué bonito nombre!'.length)
  })

  it('en inglés también saluda (la config es la misma fuente)', () => {
    expect(completedNameSpeech(STEPS, 'Luis', 'en').toLowerCase()).toContain('luis')
  })

  it('FALSIFICACIÓN: sin pasos no hay nada que decir (no se inventa la frase)', () => {
    expect(completedNameSpeech([], 'Luis', 'es')).toBe('')
  })

  it('el atajo del hook HABLA: usa el dueño y no completa en silencio', () => {
    const hook = readFileSync(join(process.cwd(), 'src/hooks/useOnboarding.ts'), 'utf8')
    expect(hook).toContain('completedNameSpeech(config.steps, trimmed, lang)')
    expect(hook).toContain('speak(despedida, lang)')
  })
})
