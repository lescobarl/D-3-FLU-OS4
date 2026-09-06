// ============================================================
// autonomyEvents.test.ts — Bus central de eventos de autonomía
// ============================================================
// Cubre la interfaz común introducida para reemplazar los
// CustomEvent 'flu-*' dispersos en window (que no tenían
// ningún listener): suscripción, emisión, cancelación y
// aislamiento de errores entre listeners.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { onAutonomyEvent, emitAutonomyEvent, type AutonomyEvent } from '../src/core/autonomy/autonomyEvents';

const event: AutonomyEvent = {
    type: 'parameter-changed',
    level: 'info',
    message: 'Parámetro foo aplicado = 42',
    detail: { parameter: 'foo', value: 42 },
};

describe('🧪 autonomyEvents — bus central de eventos de autonomía', () => {
    it('entrega el evento a todos los suscriptores', () => {
        const a = vi.fn();
        const b = vi.fn();
        const offA = onAutonomyEvent(a);
        onAutonomyEvent(b);

        emitAutonomyEvent(event);

        expect(a).toHaveBeenCalledWith(event);
        expect(b).toHaveBeenCalledWith(event);
        offA();
    });

    it('deja de entregar eventos tras cancelar la suscripción', () => {
        const listener = vi.fn();
        const off = onAutonomyEvent(listener);

        emitAutonomyEvent(event);
        off();
        emitAutonomyEvent(event);

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('un listener que lanza no impide que los demás reciban el evento', () => {
        const failing = vi.fn(() => {
            throw new Error('boom');
        });
        const healthy = vi.fn();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const offFailing = onAutonomyEvent(failing);
        onAutonomyEvent(healthy);

        expect(() => emitAutonomyEvent(event)).not.toThrow();
        expect(healthy).toHaveBeenCalledWith(event);
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
        offFailing();
    });
});
