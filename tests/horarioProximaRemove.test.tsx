// @vitest-environment jsdom
/**
 * horarioProximaRemove — Hito #5: la vista "Próxima" del horario debe tener
 * acción de borrado (las otras vistas ya la tenían). Nace ROJO.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { HorarioPizarron } from '../src/components/HorarioPizarron'

const item = {
  id: 'mat-1',
  materia: 'Matemáticas',
  dia: 1,
  inicio: '10:00',
  fin: '11:00',
} as any

function renderProxima() {
  return render(
    <HorarioPizarron
      items={[item]}
      loading={false}
      modo="proxima"
      onModoChange={() => {}}
      onAdd={async () => ({ ok: true })}
      onRemove={vi.fn(async () => {})}
      now={() => 0}
    />,
  )
}

describe('HorarioPizarron "Próxima" — borrado (#5)', () => {
  it('muestra la próxima entrada', () => {
    const { queryByTestId } = renderProxima()
    expect(queryByTestId('horario-proxima')).not.toBeNull()
  })

  it('tiene botón para borrar la entrada', () => {
    const { queryByTestId } = renderProxima()
    expect(queryByTestId('horario-remove-mat-1')).not.toBeNull()
  })
})
