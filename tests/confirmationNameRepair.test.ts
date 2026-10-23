/**
 * R1 - la reparacion del sufijo de confirmacion vive en un MODULO con puertos.
 *
 * Antes era un `useEffect` del hook que borraba participantes y reescribia filas con
 * acceso directo al store. Aqui se ejercita la regla real con dobles de los duenos.
 */
import { describe, expect, it, vi } from 'vitest';
import { repairConfirmationNameDuplicates } from '../src/core/multiuser/confirmationNameRepair';

describe('R1 - reparacion del sufijo de confirmacion', () => {
    it('borra el duplicado y devuelve sus filas a la etiqueta de su voz', async () => {
        const removeParticipant = vi.fn(async () => undefined);
        const setRowSpeakerName = vi.fn();

        const result = await repairConfirmationNameDuplicates({
            listParticipants: async () => [
                { id: '1', name: 'Luis' },
                { id: '2', name: 'Luis Registrado' },
                { id: '3', name: 'Ana' },
            ],
            removeParticipant,
            userRowsOfCurrentEpoch: () => [
                { id: 'r1', speakerId: 'speaker_2', speakerName: 'Luis Registrado' },
                { id: 'r2', speakerId: 'speaker_2', speakerName: 'Luis Registrado' },
                { id: 'r3', speakerId: 'speaker_1', speakerName: 'Luis' },
            ],
            setRowSpeakerName,
            fallbackNameForSpeakerId: (id) => (id === 'speaker_2' ? 'Hablante 2' : 'Hablante 1'),
        });

        expect(result).toEqual({ removed: 1, rowsRenamed: 2 });
        expect(removeParticipant).toHaveBeenCalledWith('2');
        expect(setRowSpeakerName).toHaveBeenCalledTimes(2);
        expect(setRowSpeakerName).toHaveBeenCalledWith('r1', 'Hablante 2');
    });

    it('sin sufijo de confirmacion no toca nada', async () => {
        const removeParticipant = vi.fn(async () => undefined);

        const result = await repairConfirmationNameDuplicates({
            listParticipants: async () => [
                { id: '1', name: 'Registrado' },
                { id: '2', name: 'Ana' },
            ],
            removeParticipant,
            userRowsOfCurrentEpoch: () => [],
            setRowSpeakerName: vi.fn(),
            fallbackNameForSpeakerId: () => 'Hablante 1',
        });

        expect(result).toEqual({ removed: 0, rowsRenamed: 0 });
        expect(removeParticipant).not.toHaveBeenCalled();
    });
});
