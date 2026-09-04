// ============================================================
// HoyPanel — Panel lateral "Hoy" del Pizarrón consolidado (Paso 2)
// ------------------------------------------------------------
// Componente presentacional controlado: recibe TODO por props desde
// App (patrón de AgendaHub / WorkspaceHub). NO hace fetching propio.
//
// Tres bloques <details> colapsables, cada etiqueta desde
// FLU_CONFIG con pickLabel (Regla #1: sin hardcode):
//   📅 HOY    → próxima clase (proximaClaseDe) + clases del día
//               (clasesDelDia) + botón "Ver horario completo" que
//               expande un HorarioPizarron (mismo shape de props que
//               WorkspaceHub le pasa).
//   📓 DIARIO → última entrada (useDiary) con su campo de ánimo
//               (mood?: number) renderizado con la etiqueta de
//               FLU_CONFIG.diary.ui / mood.ui.
//   📝 NOTAS  → listado de notas (useNotes) con toggle/remove.
// ============================================================
import { useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import type { HorarioRecord, DiaryEntryRecord, NoteRecord } from '../core/db/fluDatabase';
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
  /** Referencia de reloj (por defecto: Date.now()) para pruebas. */
  now?: () => number;
  /** Idioma actual para etiquetas bilingües (es/en). */
  language?: string;
}

// ------------------------------------------------------------
// Helper de etiquetas (paridad con pickLabel de App/WorkspaceHub)
// ------------------------------------------------------------
function pickLabel(
  labels: { es?: string; en?: string } | undefined,
  language: string,
  fallback: string
): string {
  if (!labels) return fallback;
  return labels[language === 'en' ? 'en' : 'es'] || labels.es || fallback;
}

// ------------------------------------------------------------
// Componente
// ------------------------------------------------------------
export function HoyPanel({
  horario,
  diary,
  notes,
  now = () => Date.now(),
  language = 'es',
}: HoyPanelProps) {
  const hoyUi = FLU_CONFIG.hoy?.ui ?? {};
  const diaryUi = FLU_CONFIG.diary?.ui ?? {};
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

  return (
    <aside className="hoy-panel" data-testid="hoy-panel">
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
              <div className="hoy-panel__clase" data-testid="hoy-proxima-clase">
                <span className="hoy-panel__clase-materia">{proxima.materia}</span>
                <span className="hoy-panel__clase-meta">
                  {proxima.inicio}–{proxima.fin}
                  {proxima.aula ? ` · ${proxima.aula}` : ''}
                </span>
              </div>
            )}
          </section>

          <section className="hoy-panel__section" data-testid="hoy-clases">
            <h4 className="hoy-panel__section-title">
              {pickLabel(hoyUi.clasesHoyLabel, language, 'Clases de hoy')}
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
                  <li key={clase.id} className="hoy-panel__clase">
                    <span className="hoy-panel__clase-materia">{clase.materia}</span>
                    <span className="hoy-panel__clase-meta">
                      {clase.inicio}–{clase.fin}
                      {clase.aula ? ` · ${clase.aula}` : ''}
                    </span>
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
                now={now}
                language={language}
              />
            </div>
          )}
        </div>
      </details>

      {/* ============ 📓 DIARIO (+ánimo) ============ */}
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
            <article className="hoy-panel__diario" data-testid="diario-ultima">
              <h4 className="hoy-panel__diario-title">
                {ultimaEntrada.title || diaryUi.untitledLabel || 'Sin título'}
              </h4>
              {ultimaEntrada.mood !== undefined && ultimaEntrada.mood !== null && (
                <span className="hoy-panel__diario-mood" data-testid="diario-mood">
                  {moodLabel(ultimaEntrada.mood)}
                </span>
              )}
              <p className="hoy-panel__diario-content">{ultimaEntrada.content}</p>
              <span className="hoy-panel__diario-date">{ultimaEntrada.date}</span>
            </article>
          )}
        </div>
      </details>

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
                    <li key={nota.id} className="hoy-panel__nota">
                      <label className="hoy-panel__nota-label">
                        <input
                          type="checkbox"
                          checked={nota.done}
                          onChange={() => notes.onToggle(nota.id)}
                          aria-label={nota.label}
                        />
                        <span>{nota.label}</span>
                      </label>
                      <button
                        type="button"
                        className="hoy-panel__nota-remove"
                        title={notesUi.removeTitle || 'Quitar nota'}
                        aria-label={`${notesUi.removeTitle || 'Quitar nota'}: ${nota.label}`}
                        data-testid={`nota-remove-${nota.id}`}
                        onClick={() => notes.onRemove(nota.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {notasHechas.length > 0 && (
                <ul className="hoy-panel__list" data-testid="notas-hechas">
                  {notasHechas.map((nota) => (
                    <li key={nota.id} className="hoy-panel__nota hoy-panel__nota--done">
                      <label className="hoy-panel__nota-label">
                        <input
                          type="checkbox"
                          checked={nota.done}
                          onChange={() => notes.onToggle(nota.id)}
                          aria-label={nota.label}
                        />
                        <span>{nota.label}</span>
                      </label>
                      <button
                        type="button"
                        className="hoy-panel__nota-remove"
                        title={notesUi.removeTitle || 'Quitar nota'}
                        aria-label={`${notesUi.removeTitle || 'Quitar nota'}: ${nota.label}`}
                        data-testid={`nota-remove-${nota.id}`}
                        onClick={() => notes.onRemove(nota.id)}
                      >
                        ×
                      </button>
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
