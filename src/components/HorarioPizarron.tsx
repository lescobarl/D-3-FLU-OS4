// ============================================================
// HorarioPizarron — Horario GENÉRICO en el Pizarrón
// ------------------------------------------------------------
// Componente presentacional controlado: recibe las entradas del
// horario y acciones desde App (que usa useHorario) y renderiza
// según el modo del contrato workspace.tipo='horario':
//   - semana:       rejilla semanal (días x horas) del mockup
//   - dia:          entradas de hoy
//   - proxima:      próxima entrada
//   - recordatorios:lista compacta de todas las entradas
// Incluye un formulario de alta manual (título/día/horas/lugar/
// tipo/color) para registrar una entrada sin OCR.
//
// El horario es GENÉRICO (Regla #1: sin hardcode): sirve para
// cualquier agenda (escuela, consultas médicas/IMSS, trabajo…).
// Cada entrada lleva un campo libre "tipo" que etiqueta su
// naturaleza; "titulo" es el rótulo legible y "lugar" la
// ubicación opcional. Todas las etiquetas, días, colores y la
// rejilla vienen de FLU_CONFIG.horario (ui/grid/dayLabels/
// colores/colorHex/modos).
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import type { HorarioRecord } from '../core/db/fluDatabase';
import {
  diaDeFecha,
  minutosDeFecha,
  toMin,
  type NewHorarioInput,
} from '../core/horario/horarioService';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export type HorarioModo = 'semana' | 'dia' | 'proxima' | 'recordatorios';

export interface HorarioPizarronProps {
  items: HorarioRecord[];
  loading: boolean;
  modo: HorarioModo;
  onModoChange: (modo: HorarioModo) => void;
  /** Registra una clase (el alta es gestionado por App vía useHorario). */
  onAdd: (input: NewHorarioInput) => Promise<{ ok: boolean }>;
  onRemove: (id: string) => Promise<void>;
  /** Oculta la cabecera "Horario" (cuando se embebe en el panel "Hoy"). */
  hideHeader?: boolean;
  /** Referencia de reloj (por defecto: Date.now()) para pruebas. */
  now?: () => number;
  /** Idioma actual para etiquetas bilingües (es/en). */
  language?: string;
}

// ------------------------------------------------------------
// Helpers puros (exportados para tests deterministas)
// ------------------------------------------------------------

/**
 * Próxima clase a partir de un timestamp: la clase con la menor clave
 * (dia*1440 + inicio) estrictamente posterior a "ahora"; si ninguna
 * queda hoy/semana, envuelve a la primera del ciclo (semana que viene).
 */
export function proximaClaseDe(
  items: HorarioRecord[],
  now: () => number = () => Date.now(),
): HorarioRecord | null {
  if (!items.length) return null;
  const nowKey = diaDeFecha(now()) * 1440 + minutosDeFecha(now());
  let best: HorarioRecord | null = null;
  let bestKey = Number.POSITIVE_INFINITY;
  let wrap: HorarioRecord | null = null;
  let wrapKey = Number.POSITIVE_INFINITY;
  for (const clase of items) {
    const start = toMin(clase.inicio);
    if (start < 0) continue;
    const key = clase.dia * 1440 + start;
    if (key > nowKey && key < bestKey) {
      bestKey = key;
      best = clase;
    }
    if (key < wrapKey) {
      wrapKey = key;
      wrap = clase;
    }
  }
  return best ?? wrap;
}

/** Clases del día ISO (1-7) ordenadas por hora de inicio. */
export function clasesDelDia(
  items: HorarioRecord[],
  dia: number,
): HorarioRecord[] {
  return items
    .filter((clase) => clase.dia === dia)
    .slice()
    .sort((a, b) => toMin(a.inicio) - toMin(b.inicio));
}

// ------------------------------------------------------------
// Componente
// ------------------------------------------------------------

const HORA_RE = /^(\d{1,2}):(\d{2})$/;

export function HorarioPizarron({
  items,
  loading,
  modo,
  onModoChange,
  onAdd,
  onRemove,
  hideHeader = false,
  now = () => Date.now(),
  language = 'es',
}: HorarioPizarronProps) {
  const config = (FLU_CONFIG as any).horario || {};
  const ui = config.ui || {};
  const isEn = language === 'en';
  const modos = config.modos || {};
  const dayLabels: string[] = Array.isArray(config.dayLabels) ? config.dayLabels : [];
  const dayLabelsShort: string[] = Array.isArray(config.dayLabelsShort)
    ? config.dayLabelsShort
    : [];
  const colorHex: Record<string, string> = config.colorHex || {};
  const colores: string[] = Array.isArray(config.colores) ? config.colores : [];
  const grid = config.grid || {};
  const startHour = Number(grid.startHour) || 7;
  const endHour = Number(grid.endHour) || 18;
  const hourPx = Number(grid.hourPx) || 40;
  const diaMin = Number(config.diaMin) || 1;
  const diaMax = Number(config.diaMax) || 7;
  const defaultColor = config.defaultColor || 'm1';
  const reference = now();
  const hoy = diaDeFecha(reference);

  // Formulario de alta manual.
  const [materia, setMateria] = useState('');
  const [tipo, setTipo] = useState('');
  const [dia, setDia] = useState(dayLabels[1] ? 1 : hoy);
  const [inicio, setInicio] = useState('07:00');
  const [fin, setFin] = useState('08:00');
  const [aula, setAula] = useState('');
  const [color, setColor] = useState(defaultColor);
  const [busy, setBusy] = useState(false);
  const tipoSuggestions: string[] = Array.isArray(config.tipoSuggestions)
    ? config.tipoSuggestions
    : [];

  // Confirmación visual y errores del alta manual.
  const [toast, setToast] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const toastTimerRef = useRef<number>(0);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  const handleModo = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onModoChange(event.target.value as HorarioModo);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const materiaValue = materia.trim();
    const tipoValue = tipo.trim();
    if (!materiaValue || busy) return;
    if (!HORA_RE.test(inicio) || !HORA_RE.test(fin)) return;
    setBusy(true);
    try {
      const result = await onAdd({
        materia: materiaValue,
        tipo: tipoValue || undefined,
        dia,
        inicio,
        fin,
        aula: aula.trim(),
        color,
      });
      if (result.ok) {
        setMateria('');
        setTipo('');
        setAula('');
        const template = ui.addedToast?.[isEn ? 'en' : 'es'];
        const diaLabel = dayLabels[dia] || `Día ${dia}`;
        const message = (template || '"{titulo}" agregado el {dia} {hora}')
          .replace('{titulo}', materiaValue)
          .replace('{dia}', diaLabel)
          .replace('{hora}', inicio);
        setToast(message);
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setToast(null), 4000);
      } else {
        setFormError(
          ui.addError?.[isEn ? 'en' : 'es'] || 'No se pudo registrar la entrada. Inténtalo de nuevo.',
        );
      }
    } catch (err) {
      console.warn('[HorarioPizarron] No se pudo registrar la entrada:', err);
      setFormError(
        ui.addError?.[isEn ? 'en' : 'es'] || 'No se pudo registrar la entrada. Inténtalo de nuevo.',
      );
    } finally {
      setBusy(false);
    }
  };

  const clasesHoy = useMemo(() => clasesDelDia(items, hoy), [items, hoy]);
  const proxima = useMemo(() => proximaClaseDe(items, now), [items, now]);

  // Badge de resumen en el encabezado: "3 entradas" (NO HARDCODE).
  const badgeCount =
    !loading && items.length > 0
      ? items.length === 1
        ? ui.claseCountOne?.[isEn ? 'en' : 'es'] || '1 entrada'
        : `${items.length} ${ui.claseCountMany?.[isEn ? 'en' : 'es'] || 'entradas'}`
      : null;

  // ---- Vista "semana": rejilla de días x horas ----
  const days: number[] = [];
  for (let d = diaMin; d <= diaMax; d += 1) days.push(d);
  const hours: number[] = [];
  for (let h = startHour; h < endHour; h += 1) hours.push(h);
  const startMin = startHour * 60;
  const hourRows = Math.max(1, endHour - startHour);
  const gridCols = `56px repeat(${days.length}, minmax(110px, 1fr))`;

  const renderSemana = () => (
    <div
      className="flu-horario__week"
      style={{
        gridTemplateColumns: gridCols,
        gridTemplateRows: `auto repeat(${hourRows}, ${hourPx}px)`,
      }}
      data-testid="horario-week"
    >
      <div className="flu-horario__corner" style={{ gridRow: 1, gridColumn: 1 }}>
        {ui.horaLabel || 'Hora'}
      </div>
      {days.map((d) => (
        <div
          key={`head-${d}`}
          className="flu-horario__dayhead"
          style={{ gridRow: 1, gridColumn: d - diaMin + 2 }}
        >
          {dayLabelsShort[d] || dayLabels[d] || `Día ${d}`}
        </div>
      ))}
      {hours.map((h, idx) => (
        <div
          key={`time-${h}`}
          className="flu-horario__timelabel"
          style={{ gridRow: idx + 2, gridColumn: 1 }}
        >
          {`${String(h).padStart(2, '0')}:00`}
        </div>
      ))}
      {days.map((d) => (
        <div
          key={`daycol-${d}`}
          className="flu-horario__daycol"
          style={{ gridRow: `2 / span ${hourRows}`, gridColumn: d - diaMin + 2 }}
        >
          {hours.map((h) => (
            <div
              key={`hl-${d}-${h}`}
              className="flu-horario__hourline"
              style={{ top: (h - startHour) * hourPx }}
            />
          ))}
          {items
            .filter((clase) => clase.dia === d)
            .map((clase) => {
              const cStart = toMin(clase.inicio);
              const cEnd = toMin(clase.fin);
              const top = ((cStart - startMin) / 60) * hourPx;
              const height = ((cEnd - cStart) / 60) * hourPx - 4;
              const token = colores.includes(clase.color || '') ? clase.color : defaultColor;
              return (
                <article
                  key={clase.id}
                  className={`flu-horario__cls flu-horario__cls--${token}`}
                  style={{
                    top: `${Math.max(top, 0)}px`,
                    height: `${Math.max(height, 16)}px`,
                    borderLeftColor: colorHex[token] || colorHex[defaultColor] || '#4f8cff',
                    // Tinte del token desde FLU_CONFIG.horario.colorHex — nada hardcodeado.
                    background: `color-mix(in srgb, ${colorHex[token] || colorHex[defaultColor] || '#4f8cff'} 16%, transparent)`,
                  }}
                  data-testid={`horario-clase-${clase.id}`}
                >
                  <span className="flu-horario__cls-materia">{clase.materia}</span>
                  <span className="flu-horario__cls-meta">
                    {clase.inicio}–{clase.fin}
                    {clase.aula ? ` · ${clase.aula}` : ''}
                  </span>
                  <button
                    type="button"
                    className="flu-horario__cls-remove"
                    title={ui.removeTitle || 'Quitar entrada'}
                    aria-label={`${ui.removeTitle || 'Quitar entrada'}: ${clase.materia}`}
                    data-testid={`horario-remove-${clase.id}`}
                    onClick={() => onRemove(clase.id)}
                  >
                    ×
                  </button>
                </article>
              );
            })}
        </div>
      ))}
    </div>
  );

  // ---- Vista "dia": clases de hoy ----
  const renderDia = () =>
    loading ? (
      <p className="flu-horario__empty">…</p>
    ) : clasesHoy.length === 0 ? (
      <p className="flu-horario__empty">{ui.hoyEmpty || 'Hoy no tienes entradas registradas.'}</p>
    ) : (
      <ul className="flu-horario__list" data-testid="horario-dia-list">
        {clasesHoy.map((clase) => {
          const token = colores.includes(clase.color || '') ? clase.color : defaultColor;
          return (
            <li key={clase.id} className="flu-horario__row">
              <span
                className="flu-horario__row-color"
                style={{ background: colorHex[token] || colorHex[defaultColor] || '#4f8cff' }}
              />
              <span className="flu-horario__row-materia">{clase.materia}</span>
              <span className="flu-horario__row-meta">
                {clase.inicio}–{clase.fin}
                {clase.aula ? ` · ${clase.aula}` : ''}
              </span>
              <button
                type="button"
                className="flu-horario__row-remove"
                title={ui.removeTitle || 'Quitar entrada'}
                aria-label={`${ui.removeTitle || 'Quitar entrada'}: ${clase.materia}`}
                data-testid={`horario-remove-${clase.id}`}
                onClick={() => onRemove(clase.id)}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    );

  // ---- Vista "proxima": próxima clase ----
  const renderProxima = () =>
    loading ? (
      <p className="flu-horario__empty">…</p>
    ) : !proxima ? (
      <p className="flu-horario__empty">{ui.proximaEmpty || 'No hay ninguna entrada próxima registrada.'}</p>
    ) : (
      <div className="flu-horario__proxima" data-testid="horario-proxima">
        <span className="flu-horario__proxima-dia">
          {dayLabels[proxima.dia] || `Día ${proxima.dia}`}
        </span>
        <span className="flu-horario__proxima-materia">{proxima.materia}</span>
        <span className="flu-horario__proxima-meta">
          {proxima.inicio}–{proxima.fin}
          {proxima.aula ? ` · ${proxima.aula}` : ''}
        </span>
      </div>
    );

  // ---- Vista "recordatorios": lista compacta de todas las clases ----
  const renderRecordatorios = () => {
    const agrupadas = days
      .map((d) => ({ dia: d, clases: clasesDelDia(items, d) }))
      .filter((grupo) => grupo.clases.length > 0);
    return loading ? (
      <p className="flu-horario__empty">…</p>
    ) : agrupadas.length === 0 ? (
      <p className="flu-horario__empty">{ui.emptyState || 'Sin entradas registradas.'}</p>
    ) : (
      <div className="flu-horario__recordatorios" data-testid="horario-recordatorios">
        {agrupadas.map((grupo) => (
          <section key={`grupo-${grupo.dia}`} className="flu-horario__grupo">
            <h4 className="flu-horario__grupo-dia">{dayLabels[grupo.dia] || `Día ${grupo.dia}`}</h4>
            <ul className="flu-horario__list">
              {grupo.clases.map((clase) => {
                const token = colores.includes(clase.color || '') ? clase.color : defaultColor;
                return (
                  <li key={clase.id} className="flu-horario__row">
                    <span
                      className="flu-horario__row-color"
                      style={{ background: colorHex[token] || colorHex[defaultColor] || '#4f8cff' }}
                    />
                    <span className="flu-horario__row-materia">{clase.materia}</span>
                    <span className="flu-horario__row-meta">
                      {clase.inicio}–{clase.fin}
                      {clase.aula ? ` · ${clase.aula}` : ''}
                    </span>
                    <button
                      type="button"
                      className="flu-horario__row-remove"
                      title={ui.removeTitle || 'Quitar entrada'}
                      aria-label={`${ui.removeTitle || 'Quitar entrada'}: ${clase.materia}`}
                      data-testid={`horario-remove-${clase.id}`}
                      onClick={() => onRemove(clase.id)}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    );
  };

  const modoKeys = Object.keys(modos);

  return (
    <details className="flu-settings-image-config" open>
      {!hideHeader && (
        <summary className="flu-settings-image-config__summary">
          <span className="flu-horario__summary-title">
            {ui.panelTitle || 'Horario'}
            {badgeCount && <span className="flu-badge">{badgeCount}</span>}
          </span>
        </summary>
      )}
      {toast && (
        <div className="flu-toast" role="status">
          {toast}
        </div>
      )}
      {formError && (
        <div className="flu-error-box" role="alert">
          {formError}
        </div>
      )}
      <div className="flu-settings-image-config__group">
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <div className="flu-horario__toolbar">
              <label className="flu-horario__modo-label">
                <span>{ui.modoLabel || 'Ver'}</span>
                <select
                  value={modo}
                  onChange={handleModo}
                  data-testid="horario-modo"
                  className="flu-horario__modo-select"
                >
                  {modoKeys.map((key) => (
                    <option key={key} value={key}>
                      {(modos[key] && modos[key].label) || key}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {modo === 'semana' && (
              <>
                <h4 className="flu-reminders__heading">{ui.semanaTitle || 'Horario de la semana'}</h4>
                {loading ? (
                  <p className="flu-horario__empty">…</p>
                ) : items.length === 0 ? (
                  <p className="flu-horario__empty">
                    {ui.emptyState || 'Sin entradas registradas.'}
                  </p>
                ) : (
                  renderSemana()
                )}
              </>
            )}
            {modo === 'dia' && (
              <>
                <h4 className="flu-reminders__heading">{ui.diaTitle || 'Entradas de hoy'}</h4>
                {renderDia()}
              </>
            )}
            {modo === 'proxima' && (
              <>
                <h4 className="flu-reminders__heading">{ui.proximaTitle || 'Próxima entrada'}</h4>
                {renderProxima()}
              </>
            )}
            {modo === 'recordatorios' && (
              <>
                <h4 className="flu-reminders__heading">{ui.recordatoriosTitle || 'Recordatorios'}</h4>
                {renderRecordatorios()}
              </>
            )}
          </div>
        </div>

        {/* Alta manual */}
        <form className="flu-settings-section" onSubmit={handleSubmit}>
          <div className="flu-settings-section__body">
            <div className="flu-horario__form">
              <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                <span>{ui.tituloLabel || ui.materiaLabel || 'Título'}</span>
                <input
                  type="text"
                  value={materia}
                  onChange={(event) => setMateria(event.target.value)}
                  placeholder={ui.tituloLabel || ui.materiaLabel || 'Título'}
                  data-testid="horario-add-materia"
                  disabled={busy}
                />
              </label>
              <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                <span>{ui.tipoLabel || 'Tipo (opcional)'}</span>
                <input
                  type="text"
                  list="horario-tipo-sugerencias"
                  value={tipo}
                  onChange={(event) => setTipo(event.target.value)}
                  placeholder={ui.tipoPlaceholder || 'p. ej. escuela, médico, trabajo…'}
                  data-testid="horario-add-tipo"
                  disabled={busy}
                />
                {tipoSuggestions.length > 0 && (
                  <datalist id="horario-tipo-sugerencias">
                    {tipoSuggestions.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                )}
              </label>
              <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                <span>{ui.diaLabel || 'Día'}</span>
                <select
                  value={dia}
                  onChange={(event) => setDia(Number(event.target.value))}
                  data-testid="horario-add-dia"
                  disabled={busy}
                >
                  {days.map((d) => (
                    <option key={d} value={d}>
                      {dayLabels[d] || `Día ${d}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                <span>{ui.inicioLabel || 'Inicio'}</span>
                <input
                  type="time"
                  value={inicio}
                  onChange={(event) => setInicio(event.target.value)}
                  data-testid="horario-add-inicio"
                  disabled={busy}
                />
              </label>
              <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                <span>{ui.finLabel || 'Fin'}</span>
                <input
                  type="time"
                  value={fin}
                  onChange={(event) => setFin(event.target.value)}
                  data-testid="horario-add-fin"
                  disabled={busy}
                />
              </label>
              <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                <span>{ui.lugarLabel || ui.aulaLabel || 'Lugar (opcional)'}</span>
                <input
                  type="text"
                  value={aula}
                  onChange={(event) => setAula(event.target.value)}
                  placeholder={ui.lugarLabel || ui.aulaLabel || 'Lugar (opcional)'}
                  data-testid="horario-add-aula"
                  disabled={busy}
                />
              </label>
              <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                <span>{ui.colorLabel || 'Color'}</span>
                <select
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  data-testid="horario-add-color"
                  disabled={busy}
                >
                  {colores.map((token) => (
                    <option key={token} value={token}>
                      {token}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="submit"
              className="flu-settings-image-config__field--stacked flu-horario__submit"
              data-testid="horario-add-submit"
              disabled={busy || !materia.trim()}
            >
              {ui.addLabel || 'Registrar'}
            </button>
          </div>
        </form>
      </div>
    </details>
  );
}
