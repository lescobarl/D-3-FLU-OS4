// ============================================================
// AgendaHub — Hub unificado de la pestaña "Agenda" del pizarrón
// ------------------------------------------------------------
// Conecta las funcionalidades de recordatorios / agenda / cuidado
// del adulto mayor que antes vivían solo en Ajustes y las muestra
// en la pestaña "Agenda" del WorkspaceHub.
//
// Es un componente presentacional controlado: recibe TODO el estado
// y callbacks por props desde App.tsx (que ya instancia los hooks).
// No hace fetching ni muta estado global. Los paneles internos son
// acordeones <details> que ya usan sus propias etiquetas de
// FLU_CONFIG (Rule #1: NO HARDCODE).
// ============================================================
import { ContactsPanel, type ContactsPanelProps } from './ContactsPanel';
import { DiaryPanel, type DiaryPanelProps } from './DiaryPanel';
import { MoodPanel, type MoodPanelProps } from './MoodPanel';
import { HabitsPanel, type HabitsPanelProps } from './HabitsPanel';
import { RemindersPanel, type RemindersPanelProps } from './RemindersPanel';
import { TemporalItemsPanel, type TemporalItemsPanelProps } from './TemporalItemsPanel';
import { ShoppingPanel, type ShoppingPanelProps } from './ShoppingPanel';
import { MateriaGrisPanel, type MateriaGrisPanelProps } from './MateriaGrisPanel';
import { DocumentsHistoryPanel, type DocumentsHistoryPanelProps } from './DocumentsHistoryPanel';

export interface AgendaHubProps {
  contacts: ContactsPanelProps;
  diary: DiaryPanelProps;
  mood: MoodPanelProps;
  habits: HabitsPanelProps;
  reminders: RemindersPanelProps;
  temporals: TemporalItemsPanelProps;
  shopping: ShoppingPanelProps;
  materiaGris: MateriaGrisPanelProps;
  /** Historial de documentos/imágenes generados o cargados (por usuario). */
  documents?: DocumentsHistoryPanelProps;
}

export function AgendaHub({
  contacts,
  diary,
  mood,
  habits,
  reminders,
  temporals,
  shopping,
  materiaGris,
  documents,
}: AgendaHubProps) {
  return (
    <div className="agenda-hub">
      {/* Recordatorios y agenda */}
      <section className="agenda-hub__group" aria-label="Recordatorios y agenda">
        <RemindersPanel {...reminders} />
        <TemporalItemsPanel {...temporals} />
      </section>

      {/* Cuidado diario */}
      <section className="agenda-hub__group" aria-label="Cuidado diario">
        <DiaryPanel {...diary} />
        <MoodPanel {...mood} />
        <HabitsPanel {...habits} />
        <ContactsPanel {...contacts} />
      </section>

      {/* Compras y reconocimiento */}
      <section className="agenda-hub__group" aria-label="Compras y reconocimiento">
        <ShoppingPanel {...shopping} />
        <MateriaGrisPanel {...materiaGris} />
      </section>

      {/* Historial de documentos/imágenes generados/cargados (por usuario) */}
      {documents ? (
        <section className="agenda-hub__group" aria-label="Historial">
          <DocumentsHistoryPanel {...documents} />
        </section>
      ) : null}
    </div>
  );
}
