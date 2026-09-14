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
//   📝 NOTAS  → listado con editar (✎) y quitar; el texto se expande al clic.
// ============================================================
import { useState } from 'react';
import { pickLabel } from '../lib/textUtils';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { configChild, configText } from './configText';
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
  /** Editar la materia de una clase (opcional; habilita el ✎). */
  onEdit?: (id: string, materia: string) => Promise<unknown>;
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
    /** Renombra/edita el texto de una nota (opcional; habilita el botón ✎). */
    onRename?: (id: string, label: string) => Promise<unknown>;
  };
  /** Próximas citas/recordatorios (Bug #7): recordatorios pendientes por
      fecha. Se muestran en el bloque HOY para que una cita agendada por voz
      ("crea una cita para mañana a las 10") sea visible al instante. */
  reminders?: {
    items: ReminderRecord[];
    loading: boolean;
    /** Quitar (borrado lógico) una cita/recordatorio desde la card (manual). */
    onRemove?: (id: string) => Promise<void>;
    /** Editar el texto de una cita/recordatorio desde la card. */
    onEdit?: (id: string, text: string) => Promise<unknown>;
  };
  /** Alarmas y temporizadores (motor temporal): vista compacta Outlook-style
      en el bloque HOY. Opcional para no romper consumidores que no lo proveen. */
  temporals?: {
    alarms: TemporalItemRecord[];
    timers: TemporalItemRecord[];
    loading: boolean;
    /** Cancelar una alarma/temporizador desde la card (manual). */
    onCancel?: (id: string) => Promise<void>;
    /** Editar etiqueta/hora de una alarma/temporizador desde la card. */
    onEdit?: (id: string, patch: { label?: string; timeOfDay?: string }) => Promise<unknown>;
    /** Ítem que está sonando ahora (para ofrecer "Detener"). */
    ringing?: { id: string; kind: string; label: string; at?: number } | null;
    /** Silencia la alarma/temporizador que está sonando. */
    onStopRinging?: () => void;
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
  notes,
  reminders,
  temporals,
  now = () => Date.now(),
  language = 'es',
}: HoyPanelProps) {
  const hoyUi = FLU_CONFIG.hoy?.ui ?? {};
  const notesUi = FLU_CONFIG.notes?.ui ?? {};

  // "Ver horario completo" expande el HorarioPizarron embebido.
  const [horarioExpandido, setHorarioExpandido] = useState(false);

  // ---- Edición en línea GENÉRICA (notas, citas, alarmas) + expansión de nota ----
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [editCard, setEditCard] = useState<{
    id: string;
    value: string;
    testid: string;
    save: (id: string, value: string) => void;
  } | null>(null);
  const [editTime, setEditTime] = useState('');

  const startEditCard = (
    id: string,
    value: string,
    testid: string,
    save: (id: string, value: string) => void,
  ): void => setEditCard({ id, value, testid, save });

  const commitEditCard = (): void => {
    setEditCard((current) => {
      if (!current) return null;
      const value = current.value.trim();
      if (value) current.save(current.id, value);
      return null;
    });
  };

  /** Título de card: input en línea si ESTA card está en edición. */
  const renderCardTitle = (id: string, text: string, className = 'hoy-panel__card-title') =>
    editCard?.id === id ? (
      <input
        className="hoy-panel__nota-edit"
        type="text"
        value={editCard.value}
        autoFocus
        data-testid={editCard.testid}
        onChange={(e) => setEditCard((c) => (c ? { ...c, value: e.target.value } : c))}
        onBlur={commitEditCard}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitEditCard();
          } else if (e.key === 'Escape') {
            setEditCard(null);
          }
        }}
      />
    ) : (
      <span className={className} title={text}>
        {text}
      </span>
    );

  /** Botón ✎ (editar) para una card; null si el dominio no expone edición. */
  const renderEditButton = (
    id: string,
    text: string,
    buttonTestid: string,
    inputTestid: string,
    save: ((id: string, value: string) => void) | undefined,
    label: string,
    onStart?: () => void,
  ) =>
    save ? (
      <button
        type="button"
        className="hoy-panel__card-edit"
        title={`${label}: ${text}`}
        aria-label={`${label}: ${text}`}
        data-testid={buttonTestid}
        onClick={() => {
          onStart?.();
          startEditCard(id, text, inputTestid, save);
        }}
      >
        ✎
      </button>
    ) : null;

  /** Tarjeta de nota: sin checkbox, con expandir (clic) y editar (✎). */
  const renderNota = (nota: NoteRecord, done: boolean) => (
    <li key={nota.id} className="hoy-panel__list-item">
      <div className={`hoy-panel__card${done ? ' hoy-panel__card--done' : ''}`}>
        <span className="hoy-panel__card-body">
          {editCard?.id === nota.id ? (
            renderCardTitle(nota.id, nota.label)
          ) : (
            <button
              type="button"
              className={`hoy-panel__card-title hoy-panel__nota-toggle${
                expandedNoteId === nota.id ? ' hoy-panel__card-title--expanded' : ''
              }`}
              title={nota.label}
              data-testid={`nota-expand-${nota.id}`}
              onClick={() => setExpandedNoteId(expandedNoteId === nota.id ? null : nota.id)}
            >
              {nota.label}
            </button>
          )}
        </span>
        {renderEditButton(
          nota.id,
          nota.label,
          `nota-edit-btn-${nota.id}`,
          `nota-edit-${nota.id}`,
          notes.onRename ? (id, value) => notes.onRename!(id, value) : undefined,
          notesUi.editTitle || 'Editar nota',
        )}
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
  );

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

  // ---- NOTAS: pendientes primero ----
  const notasPendientes = notes.notes.filter((n) => !n.done);
  const notasHechas = notes.notes.filter((n) => n.done);

  // Etiquetas de acción desde config (strings directos, sin hardcode).
  const removeLabel = String(notesUi.removeTitle || 'Quitar');
  const temporalsUi = configChild(configChild(FLU_CONFIG, 'temporals'), 'ui');
  const hoyUiNode = configChild(configChild(FLU_CONFIG, 'hoy'), 'ui');
  const cancelLabel = String(
    configText(temporalsUi, 'cancelTitle', '') ||
      configText(hoyUiNode, 'cancelTitle', '') ||
      'Cancelar',
  );

  return (
    <aside className="hoy-panel" data-testid="hoy-panel">
      {/* Cabecera estilo Outlook: fecha del día */}
      <header className="hoy-panel__header" data-testid="hoy-header">
        {fechaHoy ? <span className="hoy-panel__header-date">{fechaHoy}</span> : null}
      </header>

      {/* ============ 📅 HOY ============ */}
      <div className="hoy-panel__block" data-testid="hoy-block">
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
                    {editCard?.id === proxima.id ? (
                      renderCardTitle(proxima.id, proxima.materia)
                    ) : (
                      proxima.materia
                    )}
                    <span className="hoy-panel__card-horario">
                      {proxima.inicio}–{proxima.fin}
                      {proxima.aula ? ` · ${proxima.aula}` : ''}
                    </span>
                  </span>
                </span>
                {renderEditButton(
                  proxima.id,
                  proxima.materia,
                  `hoy-proxima-edit-btn-${proxima.id}`,
                  `hoy-proxima-edit-${proxima.id}`,
                  horario.onEdit ? (id, value) => horario.onEdit!(id, value) : undefined,
                  FLU_CONFIG.horario?.ui?.editTitle || 'Editar',
                )}
                {horario.onRemove && (
                  <button
                    type="button"
                    className="hoy-panel__card-remove"
                    title={FLU_CONFIG.horario?.ui?.removeTitle || 'Quitar entrada'}
                    aria-label={`${FLU_CONFIG.horario?.ui?.removeTitle || 'Quitar entrada'}: ${proxima.materia}`}
                    data-testid={`hoy-proxima-remove-${proxima.id}`}
                    onClick={() => horario.onRemove!(proxima.id)}
                  >
                    ×
                  </button>
                )}
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
                          {editCard?.id === item.id ? (
                            renderCardTitle(item.id, item.text)
                          ) : (
                            <span className="hoy-panel__card-title">📌 {item.text}</span>
                          )}
                          <span className="hoy-panel__card-meta">
                            {describeNlDateTime(item.dueAt)}
                          </span>
                        </span>
                        {renderEditButton(
                          item.id,
                          item.text,
                          `reminder-edit-btn-${item.id}`,
                          `reminder-edit-${item.id}`,
                          reminders.onEdit ? (id, value) => reminders.onEdit!(id, value) : undefined,
                          configText(hoyUi, 'editLabel', 'Editar'),
                        )}
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
              {temporals.ringing && temporals.onStopRinging && (
                <div className="hoy-panel__ringing" data-testid="temporal-ringing" role="alert">
                  <span className="hoy-panel__ringing-text">🔔 {temporals.ringing.label}</span>
                  <button
                    type="button"
                    className="hoy-panel__ringing-stop"
                    data-testid="temporal-stop"
                    onClick={() => temporals.onStopRinging?.()}
                  >
                    {pickLabel(hoyUi.stopAlarmLabel, language, 'Detener')}
                  </button>
                </div>
              )}
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
                          {editCard?.id === alarma.id ? (
                            <>
                              {renderCardTitle(alarma.id, alarma.label)}
                              {alarma.trigger?.kind === 'daily' && (
                                <input
                                  className="hoy-panel__nota-edit"
                                  type="time"
                                  value={editTime}
                                  data-testid={`temporal-edit-time-${alarma.id}`}
                                  onChange={(e) => setEditTime(e.target.value)}
                                  onBlur={commitEditCard}
                                />
                              )}
                            </>
                          ) : (
                            <span className="hoy-panel__card-title">🔔 {alarma.label}</span>
                          )}
                          <span className="hoy-panel__card-meta">
                            {formatTimeOfDayMeridiem(alarma.nextAt, language)}
                          </span>
                        </span>
                        {renderEditButton(
                          alarma.id,
                          alarma.label,
                          `temporal-edit-btn-${alarma.id}`,
                          `temporal-edit-${alarma.id}`,
                          temporals.onEdit
                            ? (id, value) =>
                                  temporals.onEdit!(
                                      id,
                                      editTime
                                          ? { label: value, timeOfDay: editTime }
                                          : { label: value },
                                  )
                            : undefined,
                          configText(hoyUi, 'editLabel', 'Editar'),
                          () =>
                            setEditTime(
                              (alarma.trigger?.kind === 'daily' && alarma.trigger.timeOfDay) || '',
                            ),
                        )}
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
                            {editCard?.id === temporizador.id ? (
                              renderCardTitle(temporizador.id, temporizador.label)
                            ) : (
                              <span className="hoy-panel__card-title">⏱️ {temporizador.label}</span>
                            )}
                            <span className="hoy-panel__card-meta">{formatCountdown(remaining)}</span>
                          </span>
                          {renderEditButton(
                            temporizador.id,
                            temporizador.label,
                            `temporal-edit-btn-${temporizador.id}`,
                            `temporal-edit-${temporizador.id}`,
                            temporals.onEdit ? (id, value) => temporals.onEdit!(id, { label: value }) : undefined,
                            configText(hoyUi, 'editLabel', 'Editar'),
                          )}
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
                          {editCard?.id === clase.id ? (
                            renderCardTitle(clase.id, clase.materia)
                          ) : (
                            clase.materia
                          )}
                          <span className="hoy-panel__card-horario">
                            {clase.inicio}–{clase.fin}
                            {clase.aula ? ` · ${clase.aula}` : ''}
                          </span>
                        </span>
                      </span>
                      {renderEditButton(
                        clase.id,
                        clase.materia,
                        `hoy-clase-edit-btn-${clase.id}`,
                        `hoy-clase-edit-${clase.id}`,
                        horario.onEdit ? (id, value) => horario.onEdit!(id, value) : undefined,
                        FLU_CONFIG.horario?.ui?.editTitle || 'Editar',
                      )}
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
      </div>

      {/* ============ 📝 NOTAS ============ */}
      <details className="hoy-panel__block" data-testid="notas-block" open>
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
                  {notasPendientes.map((nota) => renderNota(nota, false))}
                </ul>
              )}
              {notasHechas.length > 0 && (
                <ul className="hoy-panel__list" data-testid="notas-hechas">
                  {notasHechas.map((nota) => renderNota(nota, true))}
                </ul>
              )}
            </>
          )}
        </div>
      </details>
    </aside>
  );
}
