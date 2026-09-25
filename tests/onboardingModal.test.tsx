// @vitest-environment jsdom
/**
 * onboardingModal — Hito #1: el onboarding debe ser MODAL (bloquear la
 * interacción detrás) para que no choquen los dos motores de escucha.
 * Nace ROJO: antes era una tarjeta no bloqueante (sin backdrop).
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { OnboardingOverlay } from '../src/components/OnboardingOverlay'

const baseProps = {
  prompt: '¿Cómo te llamás?',
  progress: { current: 1, total: 3 },
  skipLabel: 'Omitir',
  progressLabel: '{current}/{total}',
  listeningHint: 'Escuchando',
  submitLabel: 'Enviar',
  onAnswer: () => {},
  onSkip: () => {},
} as const

describe('OnboardingOverlay es modal (#1)', () => {
  it('visible → hay backdrop que bloquea la interacción detrás', () => {
    const { queryByTestId, container } = render(<OnboardingOverlay visible {...baseProps} />)
    expect(queryByTestId('onboarding-backdrop')).not.toBeNull()
    const dialog = container.querySelector('[role="dialog"][aria-modal="true"]')
    expect(dialog).not.toBeNull()
  })

  it('oculto → sin backdrop', () => {
    const { queryByTestId } = render(<OnboardingOverlay visible={false} {...baseProps} />)
    expect(queryByTestId('onboarding-backdrop')).toBeNull()
  })
})
