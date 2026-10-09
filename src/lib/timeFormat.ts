/**
 * timeFormat.ts — DUENO UNICO de "hora local HH:MM" a partir de un instante.
 *
 * POR QUE EXISTE (auditoria 2026-10-09): habia TRES implementaciones del MISMO
 * responsable y el MISMO formato, cada una con su forma:
 *   - agendaSummary.localHHMM ------------- String(d.getHours()).padStart(2, '0')
 *   - AgendaPanel.formatTimeLabel --------- con su propio helper pad
 *   - dailyAgenda.formatReminderWhen ------ template inline
 * El detector estructural NO las ve (tres cuerpos distintos para el mismo resultado):
 * es ruta doble de PROPOSITO, no de forma. Un dueno; el formato vive una vez.
 */

/**
 * Hora local en formato HH:MM (24 h, con cero delante).
 * @param value instante en ms desde epoch, o un Date
 * @returns la hora local como HH:MM
 */
export function formatLocalHHMM(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
