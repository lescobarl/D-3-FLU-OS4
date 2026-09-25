// ============================================================
// useDocumentAnalysis — Hook F1: análisis de documentos
// ============================================================
// Flujo:
//   1. parseDocument (capa de lectura: xlsx/pdf/docx/pptx/texto)
//   2. aiService.analyzeDocument (map-reduce del LLM → DocumentContract)
//   3. Resultado en integrationStore.documentArtifact
// Degradación elegante: sin API key, el servicio devuelve un
// contrato heurístico en lugar de lanzar error (Rule #1: NO HARDCODE).
// ============================================================

import { useState, useCallback } from 'react';
import { aiService } from '../services/aiServiceFactory';
import { parseDocument, isSupportedDocument } from '../lib/documentParser';
import { useIntegrationStore } from '../store/integrationStore';
import { extractTextFromPdf } from '../services/ocrService';
import type { DocumentContract } from '../types/documentContracts';
import type { DocumentAnalysisInput } from '../core/ai/IAIService';
import { logCaughtError } from '../lib/caughtError';

export interface DocumentAnalysisState {
    /** Si el análisis está en curso */
    isAnalyzing: boolean;
    /** Error de análisis (si ocurre) */
    error: string | null;
    /** Advertencias del parser (bibliotecas no disponibles, truncado, etc.) */
    warnings: string[];
    /** Artifacto del análisis (vive en el store global) */
    documentArtifact: DocumentContract | null;
    /** Analizar un archivo de documento soportado */
    analyzeFile: (file: File, language?: string) => Promise<DocumentContract | null>;
    /** Limpiar el análisis */
    clear: () => void;
}

export function useDocumentAnalysis(language: string): DocumentAnalysisState {
    const documentArtifact = useIntegrationStore((s) => s.documentArtifact);
    const setDocumentArtifact = useIntegrationStore((s) => s.setDocumentArtifact);

    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<string[]>([]);

    const analyzeFile = useCallback(async (file: File, lang?: string): Promise<DocumentContract | null> => {
        if (!file) return null;
        if (!isSupportedDocument(file)) {
            setError('Tipo de archivo no soportado. Usa Excel, PDF, Word, PowerPoint, CSV, TXT o Markdown.');
            return null;
        }
        setIsAnalyzing(true);
        setError(null);
        try {
            const parsed = await parseDocument(file);
            setWarnings(parsed.warnings || []);

            // ── OCR local para PDFs escaneados (sin capa de texto) ──
            // Sin hardcode: el extractor local (Tesseract, spa+eng) se usa
            // como respaldo elegante cuando el parser no extrajo rawText.
            let rawText = parsed.rawText || '';
            if (file.type === 'application/pdf' && !rawText.trim()) {
                try {
                    const ocr = await extractTextFromPdf(await file.arrayBuffer());
                    if (ocr.text) rawText = `[OCR]\n${ocr.text}`;
                } catch (ocrErr) {
                    logCaughtError('[useDocumentAnalysis] OCR de PDF escaneado falló', ocrErr);
                }
            }

            const input: DocumentAnalysisInput = {
                tipo: parsed.contract.tipo,
                nombre: parsed.contract.nombre,
                mime: parsed.contract.mime,
                hojas: parsed.contract.hojas
                    ? parsed.contract.hojas.map((h) => ({
                          nombre: h.nombre,
                          rol: h.rol,
                          celdas: h.celdas,
                          errores: h.errores,
                      }))
                    : undefined,
                errores: parsed.contract.errores || [],
                chunks: parsed.chunks || [],
                rawText,
                resumen_heuristico: parsed.contract.resumen || '',
                qa_context: parsed.contract.qa_context || '',
            };

            const contract = await aiService.analyzeDocument(input, lang ?? language);
            setDocumentArtifact(contract);
            return contract;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn('[useDocumentAnalysis] Análisis de documento falló:', err);
            setError(msg);
            return null;
        } finally {
            setIsAnalyzing(false);
        }
    }, [language, setDocumentArtifact]);

    const clear = useCallback(() => {
        setDocumentArtifact(null);
        setWarnings([]);
        setError(null);
        setIsAnalyzing(false);
    }, [setDocumentArtifact]);

    return {
        isAnalyzing,
        error,
        warnings,
        documentArtifact,
        analyzeFile,
        clear,
    };
}
