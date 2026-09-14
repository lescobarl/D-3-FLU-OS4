// ============================================================
// Guard de fuente — horario por voz: scope = participante activo
// ------------------------------------------------------------
// Causa raíz (caso 9): el despacho pasaba el NOMBRE del hablante como
// `personId`, y `useHorario` filtra por el participante activo → la junta
// quedaba creada pero invisible en el panel. La entrada debe quedar
// scoped al MISMO valor que lee el hook. Patrón de guard de fuente (§B11).
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const FILE = 'src/App.tsx';

describe('horario por voz — el scope es el participante activo, no el hablante', () => {
    const source = readFileSync(join(process.cwd(), FILE), 'utf8');

    it('el despacho NO pasa el nombre del hablante como personId al horario', () => {
        expect(source).not.toMatch(
            /__fluHandleHorarioText\(intent,\s*\{[\s\S]{0,120}?personId:\s*opts\.speakerName/,
        );
    });

    it('el alta de horario usa activeParticipantId como personId', () => {
        expect(source).toMatch(/horario\.add\(\{[\s\S]{0,900}?personId:\s*activeParticipantId/);
    });
});
