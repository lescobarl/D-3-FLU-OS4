// ============================================================
// documentGenerationStore.test.ts — slices F1–F4 del store (zustand)
// ============================================================
// Cubre: setDocumentArtifact / setAppAnalysisArtifact /
// setGenerationJob, que NO se persisten (partialize los excluye)
// y que reset() los limpia a null.
// ============================================================

import { describe, test, expect, beforeEach } from 'vitest';
import { useIntegrationStore } from '../src/store/integrationStore';
import type { DocumentContract, AppAnalysisContract, GenerationJob } from '../src/types/documentContracts';

const STORE_KEY = 'flu-integration-store';

function resetStore(): void {
    useIntegrationStore.getState().reset();
}

const doc: DocumentContract = {
    tipo: 'text',
    mime: 'text/plain',
    nombre: 'doc.txt',
    tamaño: 3,
    errores: [],
    resumen: 'Resumen',
    puntos_clave: [],
    qa_context: 'qa',
};

const app: AppAnalysisContract = {
    proyecto: 'Proyecto',
    framework: 'react',
    pantallas: [],
    flujos: [],
    errores_detectados: [],
};

const job: GenerationJob = {
    id: 'gen-1',
    estado: 'listo',
    progreso: 100,
    formato: 'md',
    timestamp: 1,
};

describe('documentGenerationStore', () => {
    beforeEach(() => {
        window.localStorage.removeItem(STORE_KEY);
        resetStore();
    });

    test('el estado inicial de los slices es null', () => {
        const state = useIntegrationStore.getState();
        expect(state.documentArtifact).toBeNull();
        expect(state.appAnalysisArtifact).toBeNull();
        expect(state.generationJob).toBeNull();
    });

    test('setDocumentArtifact actualiza el artifacto de documento', () => {
        useIntegrationStore.getState().setDocumentArtifact(doc);
        expect(useIntegrationStore.getState().documentArtifact).toEqual(doc);
    });

    test('setAppAnalysisArtifact actualiza el artifacto de app', () => {
        useIntegrationStore.getState().setAppAnalysisArtifact(app);
        expect(useIntegrationStore.getState().appAnalysisArtifact).toEqual(app);
    });

    test('setGenerationJob actualiza el job de generación', () => {
        useIntegrationStore.getState().setGenerationJob(job);
        expect(useIntegrationStore.getState().generationJob).toEqual(job);
    });

    test('los slices nuevos NO se persisten en localStorage (partialize)', () => {
        useIntegrationStore.getState().setDocumentArtifact(doc);
        useIntegrationStore.getState().setAppAnalysisArtifact(app);
        useIntegrationStore.getState().setGenerationJob(job);

        const raw = JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}');
        const persisted = raw.state || raw;
        expect(persisted.documentArtifact).toBeUndefined();
        expect(persisted.appAnalysisArtifact).toBeUndefined();
        expect(persisted.generationJob).toBeUndefined();
    });

    test('reset() limpia los tres slices a null', () => {
        useIntegrationStore.getState().setDocumentArtifact(doc);
        useIntegrationStore.getState().setAppAnalysisArtifact(app);
        useIntegrationStore.getState().setGenerationJob(job);

        useIntegrationStore.getState().reset();

        expect(useIntegrationStore.getState().documentArtifact).toBeNull();
        expect(useIntegrationStore.getState().appAnalysisArtifact).toBeNull();
        expect(useIntegrationStore.getState().generationJob).toBeNull();
    });
});
