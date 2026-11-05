// ============================================================
// timeOfDay - selector unico de hora del habla (0%).
// ------------------------------------------------------------
// Modulo PURO (no se mockea nada): lee la hora del texto en es/en,
// decide cual gana cuando hay varias (meridiem explicito > hora
// concreta > parte del dia) y devuelve el texto sin las horas.
// Se cubren las tres funciones publicas y sus casos borde:
// clave sin hora, texto vacio, am/pm, palabras ("siete", "media")
// y varias horas en la misma frase.
// ============================================================
import { describe, expect, it } from 'vitest';

import { pickTimeOfDay, scanTimesOfDay, stripTimesOfDay } from '../src/core/temporal/timeOfDay';

describe('pickTimeOfDay - espanol', () => {
    it('extrae la hora de un "a las N" y limpia el resto', () => {
        const r = pickTimeOfDay('recuerdame a las 7 la cena');

        expect(r.timeOfDay).toBe('07:00');
        expect(r.rest).toContain('recuerdame');
        expect(r.rest).toContain('la cena');
        expect(r.rest).not.toContain('7');
    });

    it('resuelve la hora escrita en palabras ("a las siete")', () => {
        expect(pickTimeOfDay('avisa a las siete').timeOfDay).toBe('07:00');
    });

    it('aplica "de la tarde" sumando doce horas', () => {
        expect(pickTimeOfDay('a las 5 de la tarde').timeOfDay).toBe('17:00');
    });

    it('"12 de la noche" cae a las 00:00', () => {
        expect(pickTimeOfDay('a las 12 de la noche').timeOfDay).toBe('00:00');
    });

    it('entiende los minutos en palabras ("y media")', () => {
        expect(pickTimeOfDay('a las 6 y media').timeOfDay).toBe('06:30');
    });

    it('meridiem explicito gana a una hora "a las" anterior', () => {
        expect(pickTimeOfDay('a las 7 y tambien 10 p.m.').timeOfDay).toBe('22:00');
    });

    it('"a las 12 a.m." es medianoche', () => {
        expect(pickTimeOfDay('a las 12 a.m.').timeOfDay).toBe('00:00');
    });
});

describe('pickTimeOfDay - ingles y palabras del dia', () => {
    it('reconoce "at H am/pm"', () => {
        expect(pickTimeOfDay('the meeting is at 9 pm').timeOfDay).toBe('21:00');
    });

    it('mediodia devuelve 12:00 sin tocar el resto', () => {
        const r = pickTimeOfDay('nos vemos al mediodia');

        expect(r.timeOfDay).toBe('12:00');
        expect(r.rest).toContain('nos vemos');
    });

    it('medianoche devuelve 00:00', () => {
        expect(pickTimeOfDay('hasta a medianoche').timeOfDay).toBe('00:00');
    });
});

describe('pickTimeOfDay - casos borde', () => {
    it('sin hora devuelve null y el texto intacto', () => {
        expect(pickTimeOfDay('hola mundo')).toEqual({ timeOfDay: null, rest: 'hola mundo' });
    });

    it('texto vacio y valor ausente no revientan', () => {
        expect(pickTimeOfDay('')).toEqual({ timeOfDay: null, rest: '' });
        expect(pickTimeOfDay(undefined as unknown as string)).toEqual({ timeOfDay: null, rest: '' });
    });
});

describe('scanTimesOfDay / stripTimesOfDay', () => {
    it('recoge TODAS las horas en orden de aparicion', () => {
        const times = scanTimesOfDay('de las 7 a las 8');

        expect(times.map((t) => t.timeOfDay)).toEqual(['07:00', '08:00']);
        expect(times[0].start).toBeLessThan(times[1].start);
    });

    it('sin horas devuelve lista vacia', () => {
        expect(scanTimesOfDay('nada de nada')).toEqual([]);
    });

    it('stripTimesOfDay elimina todas las horas del texto', () => {
        const rest = stripTimesOfDay('de las 7 a las 8');

        expect(rest).not.toMatch(/\d/);
    });
});
