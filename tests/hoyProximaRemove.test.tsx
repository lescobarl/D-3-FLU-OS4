// @vitest-environment jsdom
/**
 * hoyProximaRemove — la tarjeta "Próxima" del panel HOY debe tener borrado,
// igual que "Clases de hoy" y las citas. Nace ROJO sin el botón.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { HoyPanel } from '../src/components/HoyPanel'

const proxima = {
  id: 'mat-1',
  materia: 'Matemáticas',
  dia: 1,
  inicio: '10:00',
  fin: '11:00',
} as any

function renderPanel() {
  const onRemove = vi.fn(async () => {})
  const view = render(
    <HoyPanel
      horario={{
        items: [proxima],
        loading: false,
        modo: 'proxima',
        onModoChange: () => {},
        onAdd: async () => ({ ok: true }),
        onRemove,
      }}
      diary={{ entries: [], loading: false }}
      notes={{
        notes: [],
        loading: false,
        onToggle: async () => null,
        onRemove: async () => true,
      }}
      now={() => 0}
    />,
  )
  return { ...view, onRemove }
}

describe('HoyPanel "Próxima" — borrado', () => {
  it('muestra la próxima clase', () => {
    expect(renderPanel().queryByTestId('hoy-proxima-clase')).not.toBeNull()
  })

  it('tiene botón para borrar la próxima entrada', () => {
    expect(renderPanel().queryByTestId('hoy-proxima-remove-mat-1')).not.toBeNull()
  })

  it('el botón borra la entrada', () => {
    const { getByTestId, onRemove } = renderPanel()
    fireEvent.click(getByTestId('hoy-proxima-remove-mat-1'))
    expect(onRemove).toHaveBeenCalledWith('mat-1')
  })
})
