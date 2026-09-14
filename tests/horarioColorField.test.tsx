// @vitest-environment jsdom
// ============================================================
// Guard de comportamiento — Caso 8
// ------------------------------------------------------------
// "Ver horario completo" (HorarioPizarron embebido en HoyPanel)
// no debe exponer el campo Color en el alta manual. El color se
// asigna por config (FLU_CONFIG.horario.defaultColor).
// ============================================================
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HorarioPizarron } from '../src/components/HorarioPizarron';

describe('HorarioPizarron — alta manual sin campo Color', () => {
  it('no renderiza el selector de color en la vista de horario completo', () => {
    const { container } = render(
      <HorarioPizarron
        items={[]}
        loading={false}
        modo="recordatorios"
        onModoChange={() => {}}
        onAdd={async () => ({ ok: true })}
        onRemove={async () => {}}
        hideHeader
      />,
    );

    expect(container.querySelector('[data-testid="horario-add-color"]')).toBeNull();
  });
});
