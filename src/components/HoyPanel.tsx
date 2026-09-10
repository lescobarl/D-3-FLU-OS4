// ============================================================
// HoyPanel — Panel lateral "Hoy" del Pizarrón consolidado (Paso 2)
// ------------------------------------------------------------
// Componente presentacional controlado: recibe TODO por props desde
// App (patrón de AgendaHub / WorkspaceHub). NO hace fetching propio.
//
// Diseño estilo Outlook ("Mi día"): tarjetas cronológicas con una
// columna de hora/estado a la izquierda, cuerpo y botón de acción
// (quitar/cancelar) a la derecha. Mismo lenguaje visual en Notas.
// Tres bloques <details> colapsables (etiquetas desde FLU_CONFIG):
//   📅 HOY    → "Mi día": próxima clase + citas + alarmas + clases.
//   📓 DIARIO → última entrada (useDiary) con su ánimo.
//   📝 NOTAS  → listado con checkbox + quitar (mismo diseño de card).
// ============================================================
import { useState } from 'react';
import { pickLabel } from '../lib/textUtils';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import type { HorarioRecord, DiaryEntryRecord, NoteRecord, ReminderRecord } from '../core/db/fluDatabase';
import { describeNlDateTime } from '../core/reminders/nlDateParser';
import type { TemporalItemRecord } from '../core/temporal/temporalService';
import { formatTimeOfDayMeridiem, timerRemainingMs, formatCountdown } from '../core/temporal/scheduleEngine';
import { diaDeFecha, type NewHorarioInput } from '../core/horario/horarioService';
import {
  HorarioPizarron,
  proximaClaseDe,
  clasesDelDia,
  type HorarioModo,
} from './HorarioPizarron';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

/** Fecha legible para la cabecera del panel (locale-aware, sin hardcode). */
function formatPanelDate(ts: number, language: string): string {
  try {
    return new Intl.DateTimeFormat(language === 'en' ? 'en' : 'es', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date(ts));
  } catch {
    return '';
  }
}

/** Shape del horario — paridad con WorkspaceHubProps.horario. */
export interface HoyHorarioProps {
  items: HorarioRecord[];
  loading: boolean;
  modo: HorarioModo;
  onModoChange: (modo: HorarioModo) => void;
  onAdd: (input: NewHorarioInput) => Promise<{ ok: boolean }>;
  onRemove: (id: string) => Promise<void>;
}

export interface HoyPanelProps {
  /** Horario (mismo shape que WorkspaceHub le pasa a HorarioPizarron). */
  horario: HoyHorarioProps;
  /** Última entrada del diario (useDiary) — una sola entrada. */
  diary: {
    entries: DiaryEntryRecord[];
    loading: boolean;
  };
  /** Notas (useNotes). */
  notes: {
    notes: NoteRecord[];
    loading: boolean;
    onToggle: (id: string) => Promise<NoteRecord | null>;
    onRemove: (id: string) => Promise<boolean>;
  };
  /** Próximas citas/recordatorios (Bug #7): recordatorios pendientes por
      fecha. Se muestran en el bloque HOY para que una cita agendada por voz
      ("crea una cita para mañana a las 10") sea visible al instante. */
  reminders?: {
    items: ReminderRecord[];
    loading: boolean;
    /** Quitar (borrado lógico) una cita/recordatorio desde la card (manual). */
    onRemove?: (id: string) => Promise<void>;
  };
  /** Alarmas y temporizadores (motor temporal): vista compacta Outlook-style
      en el bloque HOY. Opcional para no romper consumidores que no lo proveen. */
  temporals?: {
    alarms: TemporalItemRecord[];
    timers: TemporalItemRecord[];
    loading: boolean;
    /** Cancelar una alarma/temporizador desde la card (manual). */
    onCancel?: (id: string) => Promise<void>;
  };
  /** Referencia de reloj (por defecto: Date.now()) para pruebas. */
  now?: () => number;
  /** Idioma actual para etiquetas bilingües (es/en). */
  language?: string;
}

// ------------------------------------------------------------
// Componente
// ------------------------------------------------------------
export function HoyPanel({
  horario,
  diary,
  notes,
  reminders,
  temporals,
  now = () => Date.now(),
  language = 'es',
}: HoyPanelProps) {
  const hoyUi = FLU_CONFIG.hoy?.ui ?? {};
  const diaryUi = FLU_CONFIG.diary?.ui ?? {};
  // Diario PAUSADO: no se muestra en el panel hasta su reimplementación.
  const diarioEnabled = Boolean((FLU_CONFIG as any)?.diary?.enabled);
  const notesUi = FLU_CONFIG.notes?.ui ?? {};
  const horarioUi = FLU_CONFIG.horario?.ui ?? {};
  // Acceso por clave dinámica (mood_1..mood_5) — Regla #1: sin hardcode.
  const diaryUiAny = diaryUi as Record<string, string>;
  const moodUiAny = (FLU_CONFIG.mood?.ui ?? {}) as Record<string, string>;

  // "Ver horario completo" expande el HorarioPizarron embebido.
  const [horarioExpandido, setHorarioExpandido] = useState(false);

  // ---- HOY: próxima clase + clases del día ----
  const hoy = diaDeFecha(now());
  const proxima = proximaClaseDe(horario.items, now);
  const clasesHoy = clasesDelDia(horario.items, hoy);

  // ---- Citas/recordatorios próximos (Bug #7): pendientes ordenados por
  // fecha, recortados a los más cercanos para la vista compacta. ----
  const proximasCitas = (reminders?.items ?? [])
    .filter((item) => item.status === 'pending')
    .slice()
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, 5);

  // ---- Cabecera Outlook: fecha legible del día ----
  const fechaHoy = formatPanelDate(now(), language);

  // ---- Temporales (alarmas + temporizadores) ordenados por próximo disparo ----
  const alarmas = (temporals?.alarms ?? []).slice().sort((a, b) => a.nextAt - b.nextAt);
  const temporizadores = (temporals?.timers ?? []).slice().sort((a, b) => a.nextAt - b.nextAt);

  // ---- DIARIO: última entrada (una sola) ----
  const ultimaEntrada = diary.entries.length > 0 ? diary.entries[0] : null;

  // Etiqueta de ánimo desde la config (mood_1..mood_5), sin hardcode.
  const moodLabel = (value: number | undefined): string => {
    if (value === undefined || value === null) return pickLabel(hoyUi.sinAnimo, language, 'Sin ánimo');
    return diaryUiAny[`mood_${value}`] || moodUiAny[`mood_${value}`] || String(value);
  };

  // ---- NOTAS: pendientes primero ----
  const notasPendientes = notes.notes.filter((n) => !n.done);
  const notasHechas = notes.notes.filter((n) => n.done);

  // Etiquetas de acción desde config (strings directos, sin hardcode).
  const removeLabel = String(notesUi.removeTitle || 'Quitar');
  const cancelLabel = String(
    (FLU_CONFIG as any)?.temporals?.ui?.cancelTitle ?? (FLU_CONFIG as any)?.hoy?.ui?.cancelTitle ?? 'Cancelar',
  );

  return (
    <aside className="hoy-panel" data-testid="hoy-panel">
      {/* Cabecera estilo Outlook: fecha del día */}
      <header className="hoy-panel__header" data-testid="hoy-header">
        {fechaHoy ? <span className="hoy-panel__header-date">{fechaHoy}</span> : null}
      </header>

      {/* ============ 📅 HOY ============ */}
      <details className="hoy-panel__block" open data-testid="hoy-block">
        <summary className="hoy-panel__summary">
          {pickLabel(hoyUi.hoyTitle, language, '📅 Hoy')}
        </summary>
        <div className="hoy-panel__body">
          <section className="hoy-panel__section" data-testid="hoy-proxima">
            <h4 className="hoy-panel__section-title">
              {pickLabel(hoyUi.proximaClaseLabel, language, 'Próxima')}
            </h4>
            {horario.loading ? (
              <p className="hoy-panel__empty">…</p>
            ) : !proxima ? (
              <p className="hoy-panel__empty">
                {pickLabel(hoyUi.sinProxima, language, 'Sin próxima entrada')}
              </p>
            ) : (
              <div className="hoy-panel__card hoy-panel__card--clase" data-testid="hoy-proxima-clase">
                <span className="hoy-panel__card-time">📚</span>
                <span className="hoy-panel__card-body">
                  <span className="hoy-panel__card-title">
                    {proxima.materia}
                    <span className="hoy-panel__card-horario">
                      {proxima.inicio}–{proxima.fin}
                      {proxima.aula ? ` · ${proxima.aula}` : ''}
                    </span>
                  </span>
                </span>
              </div>
            )}
          </section>

          {reminders && (
            <section className="hoy-panel__section" data-testid="hoy-agenda">
            <h4 className="hoy-panel__section-title">
              📅 {pickLabel(hoyUi.agendaTitle, language, 'Próximas citas')}
            </h4>
              {reminders.loading ? (
                <p className="hoy-panel__empty">…</p>
              ) : proximasCitas.length === 0 ? (
                <p className="hoy-panel__empty">
                  {pickLabel(hoyUi.sinAgenda, language, 'Sin citas próximas')}
                </p>
              ) : (
                <ul className="hoy-panel__list" data-testid="hoy-agenda-list">
                  {proximasCitas.map((item) => (
                    <li key={item.id} className="hoy-panel__list-item" data-testid="hoy-agenda-item">
                      <div className="hoy-panel__card">
                        <span className="hoy-panel__card-time">
                          {formatTimeOfDayMeridiem(item.dueAt, language)}
                        </span>
                        <span className="hoy-panel__card-body">
                          <span className="hoy-panel__card-title">📌 {item.text}</span>
                          <span className="hoy-panel__card-meta">
                            {describeNlDateTime(item.dueAt)}
                          </span>
                        </span>
                        {reminders.onRemove && (
                          <button
                            type="button"
                            className="hoy-panel__card-remove"
                            title={`${removeLabel}: ${item.text}`}
                            aria-label={`${removeLabel}: ${item.text}`}
                            data-testid={`reminder-remove-${item.id}`}
                            onClick={() => reminders.onRemove!(item.id)}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {temporals && (
            <section className="hoy-panel__section" data-testid="hoy-temporales">
              <h4 className="hoy-panel__section-title">
                {pickLabel(hoyUi.alarmasTitle, language, '⏰ Alarmas')}
              </h4>
              {temporals.loading ? (
                <p className="hoy-panel__empty">…</p>
              ) : alarmas.length === 0 && temporizadores.length === 0 ? (
                <p className="hoy-panel__empty">
                  {pickLabel(hoyUi.sinTemporales, language, 'Sin alarmas ni temporizadores')}
                </p>
              ) : (
                <ul className="hoy-panel__list" data-testid="hoy-temporales-list">
                  {alarmas.map((alarma) => (
                    <li key={alarma.id} className="hoy-panel__list-item">
                      <div className="hoy-panel__card">
                        <span className="hoy-panel__card-time">
                          {formatTimeOfDayMeridiem(alarma.nextAt, language)}
                        </span>
                        <span className="hoy-panel__card-body">
                          <span className="hoy-panel__card-title">🔔 {alarma.label}</span>
                          <span className="hoy-panel__card-meta">
                            {formatTimeOfDayMeridiem(alarma.nextAt, language)}
                          </span>
                        </span>
                        {temporals.onCancel && (
                          <button
                            type="button"
                            className="hoy-panel__card-remove"
                            title={`${cancelLabel}: ${alarma.label}`}
                            aria-label={`${cancelLabel}: ${alarma.label}`}
                            data-testid={`temporal-cancel-${alarma.id}`}
                            onClick={() => temporals.onCancel!(alarma.id)}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                  {temporizadores.map((temporizador) => {
                    const remaining = timerRemainingMs(temporizador.trigger, now()) ?? 0;
                    return (
                      <li key={temporizador.id} className="hoy-panel__list-item">
                        <div className="hoy-panel__card">
                          <span className="hoy-panel__card-time">⏱️</span>
                          <span className="hoy-panel__card-body">
                            <span className="hoy-panel__card-title">⏱️ {temporizador.label}</span>
                            <span className="hoy-panel__card-meta">{formatCountdown(remaining)}</span>
                          </span>
                          {temporals.onCancel && (
                            <button
                              type="button"
                              className="hoy-panel__card-remove"
                              title={`${cancelLabel}: ${temporizador.label}`}
                              aria-label={`${cancelLabel}: ${temporizador.label}`}
                              data-testid={`temporal-cancel-${temporizador.id}`}
                              onClick={() => temporals.onCancel!(temporizador.id)}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          <section className="hoy-panel__section" data-testid="hoy-clases">
            <h4 className="hoy-panel__section-title">
              📚 {pickLabel(hoyUi.clasesHoyLabel, language, 'Clases de hoy')}
            </h4>
            {horario.loading ? (
              <p className="hoy-panel__empty">…</p>
            ) : clasesHoy.length === 0 ? (
              <p className="hoy-panel__empty">
                {pickLabel(hoyUi.sinClasesHoy, language, 'Hoy no tienes entradas')}
              </p>
            ) : (
              <ul className="hoy-panel__list" data-testid="hoy-clases-list">
                  {clasesHoy.map((clase) => (
                  <li key={clase.id} className="hoy-panel__list-item">
                    <div className="hoy-panel__card hoy-panel__card--clase">
                      <span className="hoy-panel__card-time">📚</span>
                      <span className="hoy-panel__card-body">
                        <span className="hoy-panel__card-title">
                          {clase.materia}
                          <span className="hoy-panel__card-horario">
                            {clase.inicio}–{clase.fin}
                            {clase.aula ? ` · ${clase.aula}` : ''}
                          </span>
                        </span>
                      </span>
                      {horario.onRemove && (
                        <button
                          type="button"
                          className="hoy-panel__card-remove"
                          title={FLU_CONFIG.horario?.ui?.removeTitle || 'Quitar entrada'}
                          aria-label={`${FLU_CONFIG.horario?.ui?.removeTitle || 'Quitar entrada'}: ${clase.materia}`}
                          data-testid={`hoy-clase-remove-${clase.id}`}
                          onClick={() => horario.onRemove!(clase.id)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <button
            type="button"
            className="hoy-panel__ver-horario"
            data-testid="hoy-ver-horario"
            aria-expanded={horarioExpandido}
            onClick={() => setHorarioExpandido((v) => !v)}
          >
            {pickLabel(hoyUi.verHorarioCompleto, language, 'Ver horario completo')}
          </button>

          {horarioExpandido && (
            <div className="hoy-panel__horario" data-testid="hoy-horario-completo">
              <HorarioPizarron
                items={horario.items}
                loading={horario.loading}
                modo={horario.modo}
                onModoChange={horario.onModoChange}
                onAdd={horario.onAdd}
                onRemove={horario.onRemove}
                hideHeader
                now={now}
                language={language}
              />
            </div>
          )}
        </div>
      </details>

      {/* ============ 📓 DIARIO (+ánimo) — PAUSADO (se reimplementará) ============ */}
      {diarioEnabled && (
        <details className="hoy-panel__block" data-testid="diario-block">
          <summary className="hoy-panel__summary">
            {pickLabel(hoyUi.diarioTitle, language, '📓 Diario')}
          </summary>
          <div className="hoy-panel__body">
            {diary.loading ? (
              <p className="hoy-panel__empty">…</p>
            ) : !ultimaEntrada ? (
              <p className="hoy-panel__empty">
                {pickLabel(hoyUi.sinDiario, language, 'Aún no hay entradas en el diario.')}
              </p>
            ) : (
              <article className="hoy-panel__card" data-testid="diario-ultima">
                <span className="hoy-panel__card-time">📓</span>
                <span className="hoy-panel__card-body">
                  <span className="hoy-panel__card-title">
                    {ultimaEntrada.title || diaryUi.untitledLabel || 'Sin título'}
                  </span>
                  {ultimaEntrada.mood !== undefined && ultimaEntrada.mood !== null && (
                    <span className="hoy-panel__diario-mood" data-testid="diario-mood">
                      {moodLabel(ultimaEntrada.mood)}
                    </span>
                  )}
                  <span className="hoy-panel__card-meta">{ultimaEntrada.date}</span>
                  <span className="hoy-panel__diario-content">{ultimaEntrada.content}</span>
                </span>
              </article>
            )}
          </div>
        </details>
      )}

      {/* ============ 📝 NOTAS ============ */}
      <details className="hoy-panel__block" data-testid="notas-block">
        <summary className="hoy-panel__summary">
          {pickLabel(hoyUi.notasTitle, language, '📝 Notas')}
        </summary>
        <div className="hoy-panel__body">
          {notes.loading ? (
            <p className="hoy-panel__empty">…</p>
          ) : notes.notes.length === 0 ? (
            <p className="hoy-panel__empty">
              {pickLabel(hoyUi.sinNotas, language, 'Aún no hay notas.')}
            </p>
          ) : (
            <>
              {notasPendientes.length > 0 && (
                <ul className="hoy-panel__list" data-testid="notas-pendientes">
                  {notasPendientes.map((nota) => (
                    <li key={nota.id} className="hoy-panel__list-item">
                      <div className="hoy-panel__card">
                        <label className="hoy-panel__nota-row" title={nota.label}>
                          <input
                            type="checkbox"
                            checked={nota.done}
                            onChange={() => notes.onToggle(nota.id)}
                            aria-label={nota.label}
                          />
                          <span className="hoy-panel__card-body">
                            <span className="hoy-panel__card-title">{nota.label}</span>
                          </span>
                        </label>
                        <button
                          type="button"
                          className="hoy-panel__card-remove"
                          title={notesUi.removeTitle || 'Quitar nota'}
                          aria-label={`${notesUi.removeTitle || 'Quitar nota'}: ${nota.label}`}
                          data-testid={`nota-remove-${nota.id}`}
                          onClick={() => notes.onRemove(nota.id)}
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {notasHechas.length > 0 && (
                <ul className="hoy-panel__list" data-testid="notas-hechas">
                  {notasHechas.map((nota) => (
                    <li key={nota.id} className="hoy-panel__list-item">
                      <div className="hoy-panel__card hoy-panel__card--done">
                        <label className="hoy-panel__nota-row" title={nota.label}>
                          <input
                            type="checkbox"
                            checked={nota.done}
                            onChange={() => notes.onToggle(nota.id)}
                            aria-label={nota.label}
                          />
                          <span className="hoy-panel__card-body">
                            <span className="hoy-panel__card-title">{nota.label}</span>
                          </span>
                        </label>
                        <button
                          type="button"
                          className="hoy-panel__card-remove"
                          title={notesUi.removeTitle || 'Quitar nota'}
                          aria-label={`${notesUi.removeTitle || 'Quitar nota'}: ${nota.label}`}
                          data-testid={`nota-remove-${nota.id}`}
                          onClick={() => notes.onRemove(nota.id)}
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </details>
    </aside>
  );
}
