// ============================================================
// AppAnalysisPanel — Panel de resultados del análisis F2
// ============================================================
// Presenta un AppAnalysisContract: proyecto, framework, pantallas,
// flujos funcionales y errores detectados. Presentacional puro.
// Estados comunes (analizando/error/quitar) viven en AnalysisPanelShell.
// ============================================================

import { AnalysisPanelShell } from './AnalysisPanelShell';
import { AnalysisSection } from './AnalysisSection';
import { AnalysisErrorList } from './AnalysisErrorList';
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

    if (!isAnalyzing && !error && !analysis) return null;

    const hasPantallas = Boolean(analysis && Array.isArray(analysis.pantallas) && analysis.pantallas.length > 0);
    const hasFlujos = Boolean(analysis && Array.isArray(analysis.flujos) && analysis.flujos.length > 0);
    const hasErrores = Boolean(analysis && Array.isArray(analysis.errores_detectados) && analysis.errores_detectados.length > 0);

    const header = analysis && !hideHeader ? (
        <div className="document-analysis__header">
            <h4 className="document-analysis__title">
                🧭 {isEn ? 'App Analysis' : 'Análisis de la App'}
            </h4>
            <div className="document-analysis__meta">
                <span className="document-analysis__meta-item">{analysis.proyecto}</span>
                <span className="document-analysis__meta-item">{analysis.framework}</span>
            </div>
        </div>
    ) : undefined;

    return (
        <AnalysisPanelShell
            isAnalyzing={isAnalyzing}
            analyzingText={isEn ? '🔍 Analyzing app functionality...' : '🔍 Analizando funcionalidad de la app...'}
            error={error}
            onClear={onClear}
            className="frame-content__app-analysis"
            isEn={isEn}
            header={header}
        >
            {analysis && (
                <>
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
                        <AnalysisSection title={isEn ? 'Functional flows' : 'Flujos funcionales'}>
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
                        </AnalysisSection>
                    )}

                    {hasErrores && (
                        <AnalysisErrorList
                            title={isEn ? 'Detected issues' : 'Errores detectados'}
                            items={analysis.errores_detectados}
                        />
                    )}
                </>
            )}
        </AnalysisPanelShell>
    );
}
