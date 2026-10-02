// @vitest-environment jsdom
/**
 * AssistantSettingsPanel - ajustes del asistente personal (0%).
 *
 * POR QUE ESTE TEST: es la UI que comparte el estado de DND con el centro de
 * notificaciones (el estado llega por props desde App). Se prueba la conducta
 * que de verdad importa: el canal elegido avisa al padre con el valor correcto,
 * los controles de horario SOLO aparecen con DND activado, cada cambio de hora
 * conserva el otro extremo, el checkbox de urgentes avisa, el resumen de estado
 * refleja active/scheduleLabel, y repetir onboarding delega en el padre.
 *
 * Presentacional puro: todos los handlers son props; no hay store ni red que
 * mockear.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssistantSettingsPanel } from '../src/components/AssistantSettingsPanel.js';
import type { NotificationChannel } from '../src/core/notifications/notificationService.js';
import type { DoNotDisturbState } from '../src/hooks/useDoNotDisturb.js';

const DND_BASE: DoNotDisturbState = {
    enabled: true,
    schedule: { start: '22:00', end: '07:00' },
    allowUrgent: false,
    active: false,
    scheduleLabel: '22:00 - 07:00',
};

const montar = (over: Partial<Record<string, unknown>> = {}) => {
    const props = {
        channel: (over.channel as NotificationChannel) ?? 'toast',
        onChannelChange: (over.onChannelChange as ReturnType<typeof vi.fn>) ?? vi.fn(),
        dnd: (over.dnd as DoNotDisturbState) ?? DND_BASE,
        onSetDndEnabled: (over.onSetDndEnabled as ReturnType<typeof vi.fn>) ?? vi.fn(),
        onSetDndSchedule: (over.onSetDndSchedule as ReturnType<typeof vi.fn>) ?? vi.fn(),
        onSetDndAllowUrgent: (over.onSetDndAllowUrgent as ReturnType<typeof vi.fn>) ?? vi.fn(),
        onReplayOnboarding: (over.onReplayOnboarding as ReturnType<typeof vi.fn>) ?? vi.fn(),
    };
    render(<AssistantSettingsPanel {...props} />);
    return props;
};

describe('AssistantSettingsPanel - notificaciones', () => {
    it('muestra el titulo y el canal actual con las cuatro opciones', () => {
        montar({ channel: 'voice' });

        expect(screen.getByText('Asistente personal')).toBeTruthy();
        const select = screen.getByTestId('notification-channel') as HTMLSelectElement;
        expect(select.value).toBe('voice');
        expect([...select.options].map((o) => o.value)).toEqual(['none', 'toast', 'voice', 'both']);
        expect([...select.options].map((o) => o.textContent)).toEqual([
            'Silenciar',
            'Toast (en pantalla)',
            'Voz',
            'Toast + voz',
        ]);
    });

    it('al cambiar de canal avisa al padre con el valor nuevo', () => {
        const { onChannelChange } = montar({ channel: 'toast' });

        fireEvent.change(screen.getByTestId('notification-channel'), { target: { value: 'both' } });

        expect(onChannelChange).toHaveBeenCalledTimes(1);
        expect(onChannelChange).toHaveBeenCalledWith('both');
    });
});

describe('AssistantSettingsPanel - no molestar (DND)', () => {
    it('el checkbox de DND refleja el estado y avisa al alternarlo', () => {
        const { onSetDndEnabled } = montar();
        const check = screen.getByTestId('dnd-enabled') as HTMLInputElement;

        expect(check.checked).toBe(true);
        fireEvent.click(check);

        expect(onSetDndEnabled).toHaveBeenCalledTimes(1);
        expect(onSetDndEnabled).toHaveBeenCalledWith(false);
    });

    it('con DND desactivado no se pintan horario ni urgentes', () => {
        montar({ dnd: { ...DND_BASE, enabled: false } });

        expect(screen.queryByTestId('dnd-start')).toBeNull();
        expect(screen.queryByTestId('dnd-end')).toBeNull();
        expect(screen.queryByTestId('dnd-allow-urgent')).toBeNull();
        // El canal y el onboarding siguen disponibles.
        expect(screen.getByTestId('notification-channel')).toBeTruthy();
        expect(screen.getByTestId('replay-onboarding')).toBeTruthy();
    });

    it('con DND activado las horas muestran el horario y cada cambio conserva el otro extremo', () => {
        const { onSetDndSchedule } = montar();

        const start = screen.getByTestId('dnd-start') as HTMLInputElement;
        const end = screen.getByTestId('dnd-end') as HTMLInputElement;
        expect(start.value).toBe('22:00');
        expect(end.value).toBe('07:00');

        fireEvent.change(start, { target: { value: '23:30' } });
        expect(onSetDndSchedule).toHaveBeenLastCalledWith({ start: '23:30', end: '07:00' });

        fireEvent.change(end, { target: { value: '06:15' } });
        expect(onSetDndSchedule).toHaveBeenLastCalledWith({ start: '22:00', end: '06:15' });
    });

    it('el permiso de urgentes refleja el estado y avisa al alternarlo', () => {
        const { onSetDndAllowUrgent } = montar({ dnd: { ...DND_BASE, allowUrgent: true } });
        const check = screen.getByTestId('dnd-allow-urgent') as HTMLInputElement;

        expect(check.checked).toBe(true);
        fireEvent.click(check);

        expect(onSetDndAllowUrgent).toHaveBeenCalledTimes(1);
        expect(onSetDndAllowUrgent).toHaveBeenCalledWith(false);
    });

    it('el resumen de estado combina active con el scheduleLabel recibido', () => {
        montar({ dnd: { ...DND_BASE, active: true, scheduleLabel: '23:00 - 06:00' } });

        expect(screen.getByText((_, el) => el?.textContent === 'Estado actual: Activo (23:00 - 06:00)')).toBeTruthy();
    });

    it('con DND inactivo lo marca como Inactivo', () => {
        montar({ dnd: { ...DND_BASE, active: false, scheduleLabel: '22:00 - 07:00' } });

        expect(screen.getByText((_, el) => el?.textContent === 'Estado actual: Inactivo (22:00 - 07:00)')).toBeTruthy();
    });
});

describe('AssistantSettingsPanel - onboarding', () => {
    it('repetir bienvenida delega en el padre', () => {
        const { onReplayOnboarding } = montar();

        fireEvent.click(screen.getByTestId('replay-onboarding'));

        expect(onReplayOnboarding).toHaveBeenCalledTimes(1);
    });
});
