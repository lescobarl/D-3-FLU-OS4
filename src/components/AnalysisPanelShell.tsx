/**
 * AnalysisPanelShell — esqueleto ÚNICO de un panel de análisis.
 *
 * Dueño de los estados comunes de un panel de análisis: "analizando", error con
 * `AnalysisErrorBlock`, cabecera, contenido y acción de quitar. Los paneles de
 * app y documento aportan solo su contenido y sus textos; ninguno vuelve a
 * renderizar el bloque de error por su cuenta.
 */
import type { ReactNode } from 'react'
import { AnalysisErrorBlock } from './AnalysisErrorBlock'

export interface AnalysisPanelShellProps {
  /** ¿El análisis está en curso? */
  isAnalyzing: boolean
  /** Texto del estado "analizando". */
  analyzingText: string
  /** Error del análisis, si lo hay. */
  error?: string | null
  /** Acción de quitar el panel. */
  onClear?: () => void
  /** Clase del contenedor en estado normal. */
  className: string
  /** Clase del contenedor en estado de error (si difiere). */
  errorClassName?: string
  /** Idioma activo para las etiquetas del shell. */
  isEn: boolean
  /** Test id del panel (si lo tiene). */
  testId?: string
  /** Estado de datos del panel (por defecto `done`). */
  dataState?: string
  /** Cabecera del panel, ya construida por el consumidor. */
  header?: ReactNode
  /** Contenido del panel. */
  children?: ReactNode
}

/**
 * Renderiza el esqueleto común de un panel de análisis.
 * @param props Estado, error, acción y contenido del panel.
 * @returns Panel en estado analizando, error o contenido.
 */
export function AnalysisPanelShell({
  isAnalyzing,
  analyzingText,
  error = null,
  onClear,
  className,
  errorClassName,
  isEn,
  testId,
  dataState = 'done',
  header,
  children,
}: AnalysisPanelShellProps) {
  if (isAnalyzing) {
    return (
      <div className={className} data-testid={testId} data-state="analyzing">
        <p className="flu-upload-zone__analyzing">{analyzingText}</p>
      </div>
    )
  }

  if (error) {
    return (
      <AnalysisErrorBlock
        message={error}
        onClear={onClear}
        isEn={isEn}
        className={errorClassName ?? className}
        testId={testId}
        dataState="error"
      />
    )
  }

  return (
    <div className={className} data-testid={testId} data-state={dataState}>
      {header}
      {children}
      {onClear && (
        <button
          type="button"
          className="flu-btn flu-btn--small flu-btn--danger"
          onClick={onClear}
        >
          {isEn ? 'Clear analysis' : '✕ Quitar análisis'}
        </button>
      )}
    </div>
  )
}
