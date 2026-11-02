/**
 * AnalysisErrorList — sección de errores ÚNICA de un panel de análisis.
 *
 * Dueño del bloque título + lista de errores que repetían el análisis de app y
 * el de documento.
 */
import { AnalysisSection } from './AnalysisSection'

export interface AnalysisErrorListProps {
  /** Título de la sección. */
  title: string
  /** Errores detectados. */
  items: string[]
  /** Máximo de elementos mostrados (por defecto 10). */
  limit?: number
}

/**
 * Renderiza la sección de errores de un análisis.
 * @param props Título, errores y límite.
 * @returns Sección de errores.
 */
export function AnalysisErrorList({ title, items, limit = 10 }: AnalysisErrorListProps) {
  return (
    <AnalysisSection title={title}>
      <ul className="document-analysis__error-list">
        {items.slice(0, limit).map((err, index) => (
          <li key={`${err}-${index}`} className="document-analysis__error-item">
            {err}
          </li>
        ))}
      </ul>
    </AnalysisSection>
  )
}
