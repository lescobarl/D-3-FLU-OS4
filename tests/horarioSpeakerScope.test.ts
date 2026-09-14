// ============================================================
// Guard de fuente — horario por voz: ruta ÚNICA con scope correcto
// ------------------------------------------------------------
// Causa raíz (caso 9): el despacho pasaba el NOMBRE del hablante como
// `personId`, y `useHorario` filtra por el participante activo → la junta
// quedaba creada pero invisible. La alta por voz debe pasar por la ruta
// única `addHorarioVoiceEntry` (una sola fuente, §2.8) con el participante
// activo como scope. El COMPORTAMIENTO lo cubre
// `horarioVoiceScopeBehavior.test.ts`; este guard cubre el cableado.
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const FILE = 'src/App.tsx';

describe('horario por voz — ruta única con el participante activo', () => {
    const source = readFileSync(join(process.cwd(), FILE), 'utf8');

    it('el manejador usa la ruta única (sin llamar directo al servicio)', () => {
        expect(source).toMatch(/addHorarioVoiceEntry\(/);
        const handlerStart = source.indexOf('__fluHandleHorarioText');
        const handler = handlerStart >= 0 ? source.slice(handlerStart, handlerStart + 8000) : '';
        expect(handler).not.toMatch(/horario\.add\(/);
    });

    it('la ruta única recibe el participante activo como personId', () => {
        expect(source).toMatch(
            /addHorarioVoiceEntry\(horario,\s*data,\s*\{[\s\S]{0,240}?personId:\s*activeParticipantId/,
        );
    });

    it('el despacho NO pasa el nombre del hablante como personId al horario', () => {
        expect(source).not.toMatch(
            /__fluHandleHorarioText\(intent,\s*\{[\s\S]{0,120}?personId:\s*opts\.speakerName/,
        );
    });
});
