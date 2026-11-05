/**
 * Bloque de error de un panel de resultado (análisis de app / documento).
 *
 * Dueño único del marcado "mensaje + botón limpiar": los dos paneles lo usan en
 * vez de repetirlo con clases y testids propios.
 */
export interface AnalysisErrorBlockProps {
    /** Mensaje de error a mostrar. */
    message: string;
    /** Limpia el resultado; si falta, no se pinta el botón. */
    onClear?: () => void;
    /** Idioma activo (etiqueta del botón). */
    isEn: boolean;
    /** Clases del contenedor. */
    className: string;
    /** Testid opcional del contenedor. */
    testId?: string;
    /** Estado de datos opcional del contenedor. */
    dataState?: string;
}

/** Error de análisis con acción de limpiar. */
export function AnalysisErrorBlock({ message, onClear, isEn, className, testId, dataState }: AnalysisErrorBlockProps) {
    return (
        <div className={className} data-testid={testId} data-state={dataState}>
            <p className="frame-content__document-error">{message}</p>
            {onClear && (
                <button type="button" className="flu-btn flu-btn--small" onClick={onClear}>
                    {isEn ? 'Clear' : 'Limpiar'}
                </button>
            )}
        </div>
    );
}
