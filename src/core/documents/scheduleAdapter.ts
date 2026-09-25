// ============================================================
// scheduleAdapter — Adaptador OCR/texto → HORARIO (caso particular)
// ------------------------------------------------------------
// El flujo genérico de documentos/imágenes NO debe proponer un horario para
// cualquier texto. Este adaptador solo PROPONE cuando el texto parece un
// horario real (≥ minEntries entradas válidas). Config-driven; sin hardcode.
// ============================================================
import {
  structureHorarioText,
  esNombreDeDia,
  type HorarioClaseEstructurada,
} from '../agenda/agendaShared';

export interface ScheduleProposal {
  adapterId: 'horario';
  items: HorarioClaseEstructurada[];
}

export interface ScheduleAdapterConfig {
  /** Mínimo de entradas para considerar que el texto ES un horario. */
  minEntries?: number;
}

export interface ScheduleAdapter {
  id: 'horario';
  /** Propone entradas si el texto parece un horario; null en caso contrario. */
  propose(text: string): ScheduleProposal | null;
}

export function createScheduleAdapter(config: ScheduleAdapterConfig = {}): ScheduleAdapter {
  const minEntries = Math.max(1, Number(config.minEntries) || 2);
  return {
    id: 'horario',
    propose(text: string): ScheduleProposal | null {
      const items = structureHorarioText(text).filter((item) => !esNombreDeDia(item.materia));
      if (items.length < minEntries) return null;
      return { adapterId: 'horario', items };
    },
  };
}
