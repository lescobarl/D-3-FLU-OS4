// ============================================================
// describeTriggerText — texto humano del disparo de agenda
// ------------------------------------------------------------
// Bug real: la confirmación decía "vie", "jue", "mar" (abreviaturas). Ahora usa
// el NOMBRE COMPLETO del día vía `toLocaleDateString` (localizado, sin listas en
// duro) tanto para fecha puntual como para recurrencia semanal.
// ============================================================
import { formatTimeOfDayMeridiem } from '../temporal/scheduleEngine';
import type { AgendaTrigger } from './agendaModel';

/** 2024-01-07 fue DOMINGO (getDay() === 0): base para mapear índice → nombre. */
const SUNDAY_REF = 7;

function weekdayName(dayIndex: number, lang: string): string {
    const locale = lang === 'en' ? 'en-US' : 'es-MX';
    const date = new Date(2024, 0, SUNDAY_REF + dayIndex);
    return date.toLocaleDateString(locale, { weekday: 'long' });
}

/** Texto legible del disparo ("jueves a las 10:30 a.m.", "los lunes, jueves a las 08:00"). */
export function describeTriggerWhen(trigger: AgendaTrigger, lang: string): string {
    const t = trigger;
    if (t.type === 'absolute' && t.at !== undefined) {
        const day = weekdayName(new Date(t.at).getDay(), lang);
        return `${day} a las ${formatTimeOfDayMeridiem(t.at, lang)}`;
    }
    if (t.type === 'daily') return `todos los días a las ${t.timeOfDay}`;
    if (t.type === 'weekly') {
        const days = (t.daysOfWeek ?? []).map((d) => weekdayName(d, lang)).join(', ');
        return `los ${days} a las ${t.timeOfDay}`;
    }
    return '';
}
