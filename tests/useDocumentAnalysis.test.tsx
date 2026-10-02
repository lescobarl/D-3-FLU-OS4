// @vitest-environment jsdom
// ============================================================
// useDocumentAnalysis - analisis de documentos (F1, 0% cobertura)
// ------------------------------------------------------------
// Fronteras sustituidas: parser (lectura de ficheros), aiService (map-reduce
// del LLM), OCR local (PDF escaneado), el store global y el log de errores.
// El modulo bajo prueba NO se mockea: se ejerce su politica real de validacion
// de tipo, mapeo del contrato al input y degradacion cuando OCR o LLM fallan.
// ============================================================
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
    analyzeDocument: vi.fn(),
    parseDocument: vi.fn(),
    isSupportedDocument: vi.fn(),
    extractTextFromPdf: vi.fn(),
    logCaughtError: vi.fn(),
    store: {
        documentArtifact: null as unknown,
        setDocumentArtifact: vi.fn(),
    },
}));

vi.mock('../src/services/aiServiceFactory', () => ({ aiService: { analyzeDocument: dobles.analyzeDocument } }));
vi.mock('../src/lib/documentParser', () => ({
    parseDocument: dobles.parseDocument,
    isSupportedDocument: dobles.isSupportedDocument,
}));
vi.mock('../src/services/ocrService', () => ({ extractTextFromPdf: dobles.extractTextFromPdf }));
vi.mock('../src/lib/caughtError', () => ({ logCaughtError: dobles.logCaughtError }));
vi.mock('../src/store/integrationStore', () => ({
    useIntegrationStore: (selector: (s: typeof dobles.store) => unknown) => selector(dobles.store),
}));

import { useDocumentAnalysis } from '../src/hooks/useDocumentAnalysis';

const baseContract = {
    tipo: 'xlsx',
    nombre: 'datos.xlsx',
    mime: 'application/xlsx',
    hojas: [{ nombre: 'Hoja1', rol: 'input', celdas: 12, errores: [] }],
    errores: ['e1'],
    resumen: 'resumen',
    qa_context: 'qa',
};

const parsedFor = (
    contractOver: Record<string, unknown> = {},
    over: Record<string, unknown> = {},
) => ({
    contract: { ...baseContract, ...contractOver },
    rawText: 'texto crudo',
    chunks: ['chunk-1'],
    warnings: ['aviso-1'],
    ...over,
});

const contractOut = { tipo: 'xlsx', nombre: 'datos.xlsx', hojas: [], errores: [], resumen: 'r', qa_context: 'q' };

/** Stub minimo de File: el hook solo consume type y arrayBuffer(). */
const archivo = (type: string, buffer?: ArrayBuffer) =>
    ({ type, arrayBuffer: async () => buffer ?? new ArrayBuffer(4) }) as unknown as File;

const montar = () => renderHook(() => useDocumentAnalysis('es'));

beforeEach(() => {
    dobles.analyzeDocument.mockReset();
    dobles.parseDocument.mockReset();
    dobles.isSupportedDocument.mockReset();
    dobles.extractTextFromPdf.mockReset();
    dobles.logCaughtError.mockReset();
    dobles.store.documentArtifact = null;
    dobles.store.setDocumentArtifact.mockReset();
    dobles.store.setDocumentArtifact.mockImplementation((v: unknown) => {
        dobles.store.documentArtifact = v;
    });
    dobles.isSupportedDocument.mockReturnValue(true);
    dobles.analyzeDocument.mockResolvedValue(contractOut);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ------------------------------------------------------------
// Bloque: validacion de entrada (no toca el parser ni el LLM)
// ------------------------------------------------------------
describe('useDocumentAnalysis - validacion de entrada', () => {
    it('un tipo no soportado fija el error y no llama al parser ni al LLM', async () => {
        dobles.isSupportedDocument.mockReturnValue(false);
        const { result } = montar();

        let salida: unknown = 'sin-asignar';
        await act(async () => {
            salida = await result.current.analyzeFile(archivo('application/zip'));
        });

        expect(salida).toBeNull();
        expect(result.current.error).toContain('no soportado');
        expect(result.current.isAnalyzing).toBe(false);
        expect(dobles.parseDocument).not.toHaveBeenCalled();
        expect(dobles.analyzeDocument).not.toHaveBeenCalled();
    });

    it('un archivo ausente devuelve null sin consultar el soporte', async () => {
        const { result } = montar();

        let salida: unknown = 'sin-asignar';
        await act(async () => {
            salida = await result.current.analyzeFile(null as unknown as File);
        });

        expect(salida).toBeNull();
        expect(dobles.isSupportedDocument).not.toHaveBeenCalled();
        expect(dobles.parseDocument).not.toHaveBeenCalled();
    });
});

// ------------------------------------------------------------
// Bloque: camino feliz y mapeo al DocumentAnalysisInput
// ------------------------------------------------------------
describe('useDocumentAnalysis - analisis y mapeo', () => {
    it('publica el contrato en el store y devuelve sus warnings', async () => {
        dobles.parseDocument.mockResolvedValue(parsedFor());
        const { result } = montar();

        let salida: unknown = null;
        await act(async () => {
            salida = await result.current.analyzeFile(archivo('text/plain'));
        });

        expect(salida).toEqual(contractOut);
        expect(result.current.documentArtifact).toEqual(contractOut);
        expect(result.current.warnings).toEqual(['aviso-1']);
        expect(result.current.error).toBeNull();
        expect(result.current.isAnalyzing).toBe(false);
    });

    it('mapea el contrato (hojas reducidas, resumen heuristico) y usa el idioma del hook', async () => {
        dobles.parseDocument.mockResolvedValue(parsedFor());
        const { result } = montar();

        await act(async () => {
            await result.current.analyzeFile(archivo('text/plain'));
        });

        expect(dobles.analyzeDocument).toHaveBeenCalledWith(
            {
                tipo: 'xlsx',
                nombre: 'datos.xlsx',
                mime: 'application/xlsx',
                hojas: [{ nombre: 'Hoja1', rol: 'input', celdas: 12, errores: [] }],
                errores: ['e1'],
                chunks: ['chunk-1'],
                rawText: 'texto crudo',
                resumen_heuristico: 'resumen',
                qa_context: 'qa',
            },
            'es',
        );
    });

    it('el idioma explicito gana al del hook', async () => {
        dobles.parseDocument.mockResolvedValue(parsedFor());
        const { result } = montar();

        await act(async () => {
            await result.current.analyzeFile(archivo('text/plain'), 'en');
        });

        expect(dobles.analyzeDocument).toHaveBeenCalledWith(expect.anything(), 'en');
    });

    it('sin hojas en el contrato el input lleva hojas undefined', async () => {
        dobles.parseDocument.mockResolvedValue(parsedFor({ hojas: undefined }));
        const { result } = montar();

        await act(async () => {
            await result.current.analyzeFile(archivo('text/plain'));
        });

        expect(dobles.analyzeDocument).toHaveBeenCalledWith(
            expect.objectContaining({ hojas: undefined }),
            'es',
        );
    });
});

// ------------------------------------------------------------
// Bloque: OCR de respaldo para PDF escaneado
// ------------------------------------------------------------
describe('useDocumentAnalysis - OCR de PDF', () => {
    it('un PDF sin texto usa el OCR y prefija rawText con [OCR]', async () => {
        const buffer = new ArrayBuffer(8);
        dobles.parseDocument.mockResolvedValue(parsedFor({}, { rawText: '' }));
        dobles.extractTextFromPdf.mockResolvedValue({ text: 'contenido ocr', engine: 'local', warnings: [] });
        const { result } = montar();

        await act(async () => {
            await result.current.analyzeFile(archivo('application/pdf', buffer));
        });

        expect(dobles.extractTextFromPdf).toHaveBeenCalledWith(buffer);
        expect(dobles.analyzeDocument).toHaveBeenCalledWith(
            expect.objectContaining({ rawText: '[OCR]\ncontenido ocr' }),
            'es',
        );
    });

    it('un PDF con texto propio NO invoca el OCR', async () => {
        dobles.parseDocument.mockResolvedValue(parsedFor({}, { rawText: 'texto incrustado' }));
        const { result } = montar();

        await act(async () => {
            await result.current.analyzeFile(archivo('application/pdf'));
        });

        expect(dobles.extractTextFromPdf).not.toHaveBeenCalled();
        expect(dobles.analyzeDocument).toHaveBeenCalledWith(
            expect.objectContaining({ rawText: 'texto incrustado' }),
            'es',
        );
    });

    it('si el OCR falla se registra el fallo y el analisis continua sin texto', async () => {
        dobles.parseDocument.mockResolvedValue(parsedFor({}, { rawText: '' }));
        dobles.extractTextFromPdf.mockRejectedValue(new Error('tesseract caido'));
        const { result } = montar();

        await act(async () => {
            await result.current.analyzeFile(archivo('application/pdf'));
        });

        expect(dobles.logCaughtError).toHaveBeenCalledWith(
            expect.stringContaining('OCR de PDF'),
            expect.any(Error),
        );
        expect(dobles.analyzeDocument).toHaveBeenCalledWith(
            expect.objectContaining({ rawText: '' }),
            'es',
        );
    });
});

// ------------------------------------------------------------
// Bloque: errores y limpieza
// ------------------------------------------------------------
describe('useDocumentAnalysis - errores y clear', () => {
    it('si el LLM rechaza fija el mensaje de error y devuelve null', async () => {
        dobles.parseDocument.mockResolvedValue(parsedFor());
        dobles.analyzeDocument.mockRejectedValue(new Error('llm caido'));
        const { result } = montar();

        let salida: unknown = 'sin-asignar';
        await act(async () => {
            salida = await result.current.analyzeFile(archivo('text/plain'));
        });

        expect(salida).toBeNull();
        expect(result.current.error).toBe('llm caido');
        expect(result.current.isAnalyzing).toBe(false);
        expect(result.current.documentArtifact).toBeNull();
    });

    it('si el parser rechaza tambien se captura el error', async () => {
        dobles.parseDocument.mockRejectedValue(new Error('lectura rota'));
        const { result } = montar();

        let salida: unknown = 'sin-asignar';
        await act(async () => {
            salida = await result.current.analyzeFile(archivo('text/plain'));
        });

        expect(salida).toBeNull();
        expect(result.current.error).toBe('lectura rota');
    });

    it('clear limpia el artifacto, los warnings y el error', async () => {
        dobles.parseDocument.mockResolvedValue(parsedFor());
        const { result } = montar();
        await act(async () => {
            await result.current.analyzeFile(archivo('text/plain'));
        });
        expect(result.current.documentArtifact).toEqual(contractOut);

        act(() => {
            result.current.clear();
        });

        expect(result.current.documentArtifact).toBeNull();
        expect(result.current.warnings).toEqual([]);
        expect(result.current.error).toBeNull();
        expect(result.current.isAnalyzing).toBe(false);
    });
});
