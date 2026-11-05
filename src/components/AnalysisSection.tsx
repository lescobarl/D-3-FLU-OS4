/**
 * AnalysisSection — sección con título ÚNICA de un panel de análisis.
 *
 * Dueño de la envoltura `errors` + subtítulo que repetían app, documento y la
 * lista de errores.
 */
import type { ReactNode } from 'react'

export interface AnalysisSectionProps {
  /** Título de la sección. */
  title: string
  /** Contenido de la sección. */
  children: ReactNode
}

/**
 * Renderiza una sección titulada de un panel de análisis.
 * @param props Título y contenido.
 * @returns Sección del panel.
 */
export function AnalysisSection({ title, children }: AnalysisSectionProps) {
  return (
    <div className="document-analysis__errors">
      <h5 className="document-analysis__subtitle">{title}</h5>
      {children}
    </div>
  )
}
