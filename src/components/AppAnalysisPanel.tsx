// ============================================================
// AppAnalysisPanel — Panel de resultados del análisis F2
// ============================================================
// Presenta un AppAnalysisContract: proyecto, framework, pantallas,
// flujos funcionales y errores detectados. Presentacional puro.
// ============================================================

import type { AppAnalysisContract } from '../types/documentContracts';

export interface AppAnalysisPanelProps {
    analysis: AppAnalysisContract | null;
    isAnalyzing?: boolean;
    error?: string | null;
    onClear?: () => void;
    language?: string;
    hideHeader?: boolean;
}

export default function AppAnalysisPanel({
    analysis,
    isAnalyzing = false,
    error = null,
    onClear,
    language = 'es',
    hideHeader = false,
}: AppAnalysisPanelProps) {
    const isEn = language === 'en';

    if (isAnalyzing) {
        return (
            <div className="frame-content__app-analysis">
                <p className="flu-upload-zone__analyzing">
                    {isEn ? '🔍 Analyzing app functionality...' : '🔍 Analizando funcionalidad de la app...'}
                </p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="frame-content__app-analysis">
                <p className="frame-content__document-error">{error}</p>
                {onClear && (
                    <button type="button" className="flu-btn flu-btn--small" onClick={onClear}>
                        {isEn ? 'Clear' : 'Limpiar'}
                    </button>
                )}
            </div>
        );
    }

    if (!analysis) return null;

    const hasPantallas = Array.isArray(analysis.pantallas) && analysis.pantallas.length > 0;
    const hasFlujos = Array.isArray(analysis.flujos) && analysis.flujos.length > 0;
    const hasErrores = Array.isArray(analysis.errores_detectados) && analysis.errores_detectados.length > 0;

    return (
        <div className="frame-content__app-analysis">
            {!hideHeader && (
                <div className="document-analysis__header">
                    <h4 className="document-analysis__title">
                        🧭 {isEn ? 'App Analysis' : 'Análisis de la App'}
                    </h4>
                    <div className="document-analysis__meta">
                        <span className="document-analysis__meta-item">{analysis.proyecto}</span>
                        <span className="document-analysis__meta-item">{analysis.framework}</span>
                    </div>
                </div>
            )}

            {hasPantallas && (
                <div className="document-analysis__sheets">
                    <h5 className="document-analysis__subtitle">
                        {isEn ? 'Screens' : 'Pantallas'} ({analysis.pantallas.length})
                    </h5>
                    <ul className="document-analysis__sheet-list">
                        {analysis.pantallas.map((p) => (
                            <li key={p.id || p.nombre} className="document-analysis__sheet-item">
                                <span className="document-analysis__sheet-name">{p.nombre}</span>
                                <p className="document-analysis__app-proposito">{p.proposito}</p>
                                {p.entradas.length > 0 && (
                                    <p className="document-analysis__app-line">
                                        <strong>{isEn ? 'Inputs:' : 'Entradas:'}</strong> {p.entradas.join(', ')}
                                    </p>
                                )}
                                {p.acciones.length > 0 && (
                                    <p className="document-analysis__app-line">
                                        <strong>{isEn ? 'Actions:' : 'Acciones:'}</strong> {p.acciones.join(', ')}
                                    </p>
                                )}
                                {p.salidas.length > 0 && (
                                    <p className="document-analysis__app-line">
                                        <strong>{isEn ? 'Outputs:' : 'Salidas:'}</strong> {p.salidas.join(', ')}
                                    </p>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {hasFlujos && (
                <div className="document-analysis__errors">
                    <h5 className="document-analysis__subtitle">
                        {isEn ? 'Functional flows' : 'Flujos funcionales'}
                    </h5>
                    {analysis.flujos.map((f, index) => (
                        <details key={`${f.nombre}-${index}`} className="document-analysis__scenario">
                            <summary>{f.nombre}</summary>
                            <ol className="document-analysis__flow-steps">
                                {f.pasos.map((paso, i) => (
                                    <li key={i}>{paso}</li>
                                ))}
                            </ol>
                        </details>
                    ))}
                </div>
            )}

            {hasErrores && (
                <div className="document-analysis__errors">
                    <h5 className="document-analysis__subtitle">
                        {isEn ? 'Detected issues' : 'Errores detectados'}
                    </h5>
                    <ul className="document-analysis__error-list">
                        {analysis.errores_detectados.slice(0, 10).map((err, index) => (
                            <li key={`${err}-${index}`} className="document-analysis__error-item">
                                {err}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

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
    );
}
