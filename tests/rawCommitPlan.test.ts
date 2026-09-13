// ============================================================
// rawCommitPlan.test.ts — Guard §9: una frase → UNA fila
// ------------------------------------------------------------
// Reproduce el bug real: primera emisión commiteada con hablante provisional
// ("Hablante 1") y emisión final con la voz ya resuelta ("Luis"). El reemplazo
// debe actualizar ESA fila por id de emisión, no buscar por nombre (que fallaba
// y duplicaba la fila).
// ============================================================
import { describe, expect, it } from 'vitest';

import { planRawCommit } from '../src/voice/lib/rawCommitPlan';

describe('planRawCommit — reemplazo por identidad de emisión (no por hablante)', () => {
    it('misma emisión con hablante resuelto reemplaza la fila provisional', () => {
        const history = [
            { id: 'row-1', text: 'Okay flu Busca en la web Cómo se construyen los edificios', speakerName: 'Hablante 1' },
        ];
        const plan = planRawCommit(history, {
            replaceLastRawLog: true,
            lastRawEntryId: 'row-1',
            speakerName: 'Luis',
        });
        expect(plan).toEqual({ action: 'replace', index: 0, speakerName: 'Luis' });
    });

    it('el resultado es UNA sola fila (no duplica el hablante)', () => {
        let history = [
            { id: 'row-1', text: 'Okay flu Busca en la web Cómo se construyen los edificios', speakerName: 'Hablante 1' },
        ];
        const plan = planRawCommit(history, {
            replaceLastRawLog: true,
            lastRawEntryId: 'row-1',
            speakerName: 'Luis',
        });
        expect(plan.action).toBe('replace');
        if (plan.action === 'replace') {
            const updated = [...history];
            updated[plan.index] = {
                ...updated[plan.index],
                text: 'Okay flu Busca en la web Cómo se construyen los edificios altos',
                speakerName: plan.speakerName,
            };
            history = updated;
        }
        expect(history).toHaveLength(1);
        expect(history[0].speakerName).toBe('Luis');
        expect(history[0].text).toContain('edificios altos');
    });

    it('conserva el hablante previo si la nueva emisión no trae nombre', () => {
        const plan = planRawCommit(
            [{ id: 'row-1', speakerName: 'Luis' }],
            { replaceLastRawLog: true, lastRawEntryId: 'row-1', speakerName: '' },
        );
        expect(plan).toEqual({ action: 'replace', index: 0, speakerName: 'Luis' });
    });

    it('cae al provisional si no hay hablante previo ni nuevo', () => {
        const plan = planRawCommit(
            [{ id: 'row-1' }],
            { replaceLastRawLog: true, lastRawEntryId: 'row-1', speakerName: '' },
        );
        expect(plan).toEqual({ action: 'replace', index: 0, speakerName: 'Hablante 1' });
    });

    it('sin señal del motor → fila nueva (append)', () => {
        expect(
            planRawCommit([{ id: 'row-1', speakerName: 'Luis' }], {
                replaceLastRawLog: false,
                lastRawEntryId: 'row-1',
                speakerName: 'Luis',
            }),
        ).toEqual({ action: 'append' });
    });

    it('señal de reemplazo pero id ausente → fila nueva (append)', () => {
        expect(
            planRawCommit([{ id: 'row-1' }], {
                replaceLastRawLog: true,
                lastRawEntryId: 'row-404',
                speakerName: 'Luis',
            }),
        ).toEqual({ action: 'append' });
    });

    it('historial inválido → append (no lanza)', () => {
        expect(
            planRawCommit(undefined as any, { replaceLastRawLog: true, lastRawEntryId: 'x', speakerName: '' }),
        ).toEqual({ action: 'append' });
        expect(
            planRawCommit(null as any, { replaceLastRawLog: true, lastRawEntryId: 'x', speakerName: '' }),
        ).toEqual({ action: 'append' });
    });
});
