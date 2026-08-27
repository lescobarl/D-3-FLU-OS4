// ============================================================
// DocumentResultPanel — Panel de resultados del análisis F1
// ============================================================
// Presenta un DocumentContract: metadatos, resumen, puntos clave,
// hojas de cálculo (rol/celdas/errores) y escenarios detectados.
// Componente puramente presentacional — los datos vienen del store.
// ============================================================

import type { DocumentContract } from '../types/documentContracts';

export interface DocumentResultPanelProps {
    document: DocumentContract | null;
    isAnalyzing?: boolean;
    warnings?: string[];
    error?: string | null;
    onClear?: () => void;
    language?: string;
}

function formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const TIPO_LABEL: Record<string, string> = {
    xlsx: 'Excel',
    xlsm: 'Excel (macro)',
    pdf: 'PDF',
    docx: 'Word',
    pptx: 'PowerPoint',
    csv: 'CSV',
    md: 'Markdown',
    text: 'Texto',
};

export default function DocumentResultPanel({
    document,
    isAnalyzing = false,
    warnings = [],
    error = null,
    onClear,
    language = 'es',
}: DocumentResultPanelProps) {
    const isEn = language === 'en';

    if (isAnalyzing) {
        return (
            <div className="frame-content__document-analysis">
                <p className="flu-upload-zone__analyzing">
                    {isEn ? '🔍 Analyzing document with AI...' : '🔍 Analizando documento con IA...'}
                </p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="frame-content__document-analysis frame-content__document-analysis--error">
                <p className="frame-content__document-error">{error}</p>
                {onClear && (
                    <button type="button" className="flu-btn flu-btn--small" onClick={onClear}>
                        {isEn ? 'Clear' : 'Limpiar'}
                    </button>
                )}
            </div>
        );
    }

    if (!document) {
        return null;
    }

    const hasPuntos = Array.isArray(document.puntos_clave) && document.puntos_clave.length > 0;
    const hasHojas = Array.isArray(document.hojas) && document.hojas.length > 0;
    const hasErrores = Array.isArray(document.errores) && document.errores.length > 0;
    const hasEscenarios = Array.isArray(document.escenarios) && document.escenarios.length > 0;

    return (
        <div className="frame-content__document-analysis">
            <div className="document-analysis__header">
                <h4 className="document-analysis__title">
                    📄 {isEn ? 'Document Analysis' : 'Análisis de Documento'}
                </h4>
                <div className="document-analysis__meta">
                    <span className="document-analysis__meta-item">
                        {TIPO_LABEL[document.tipo] || document.tipo}
                    </span>
                    <span className="document-analysis__meta-item" title={document.nombre}>
                        {document.nombre}
                    </span>
                    <span className="document-analysis__meta-item">{formatBytes(document.tamaño)}</span>
                </div>
            </div>

            <div className="homework-analysis__detail">
                <span className="homework-analysis__label">
                    {isEn ? 'Summary:' : 'Resumen:'}
                </span>{' '}
                {document.resumen || '—'}
            </div>

            {hasPuntos && (
                <ul className="frame-content__list">
                    {document.puntos_clave.map((punto: string, index: number) => (
                        <li key={`${punto}-${index}`}>{punto}</li>
                    ))}
                </ul>
            )}

            {hasHojas && (
                <div className="document-analysis__sheets">
                    <h5 className="document-analysis__subtitle">
                        {isEn ? 'Sheets' : 'Hojas de cálculo'}
                    </h5>
                    <ul className="document-analysis__sheet-list">
                        {document.hojas?.map((hoja, index) => (
                            <li key={`${hoja.nombre}-${index}`} className="document-analysis__sheet-item">
                                <span className="document-analysis__sheet-name">{hoja.nombre}</span>
                                <span className={`document-analysis__sheet-rol document-analysis__sheet-rol--${hoja.rol}`}>
                                    {hoja.rol}
                                </span>
                                <span className="document-analysis__sheet-cells">{hoja.celdas} celdas</span>
                                {Array.isArray(hoja.errores) && hoja.errores.length > 0 && (
                                    <ul className="document-analysis__sheet-errors">
                                        {hoja.errores.slice(0, 4).map((e, i) => (
                                            <li key={i}>{e}</li>
                                        ))}
                                    </ul>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {hasErrores && (
                <div className="document-analysis__errors">
                    <h5 className="document-analysis__subtitle">
                        {isEn ? 'Detected formula errors' : 'Errores de fórmula detectados'}
                    </h5>
                    <ul className="document-analysis__error-list">
                        {document.errores.slice(0, 10).map((err, index) => (
                            <li key={`${err}-${index}`} className="document-analysis__error-item">
                                {err}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {hasEscenarios && (
                <div className="document-analysis__scenarios">
                    <h5 className="document-analysis__subtitle">
                        {isEn ? 'Scenarios' : 'Escenarios'}
                    </h5>
                    {document.escenarios?.map((esc, index) => (
                        <details key={index} className="document-analysis__scenario">
                            <summary>
                                {String(esc.nombre || esc.titulo || `Escenario ${index + 1}`)}
                            </summary>
                            <p className="document-analysis__scenario-body">
                                {String(esc.descripcion || JSON.stringify(esc))}
                            </p>
                        </details>
                    ))}
                </div>
            )}

            {warnings.length > 0 && (
                <div className="document-analysis__warnings">
                    {warnings.map((w, i) => (
                        <p key={i} className="document-analysis__warning">
                            ⚠️ {w}
                        </p>
                    ))}
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
