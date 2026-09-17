// ============================================================
// workspaceArtifactPersonIsolation.test.ts — Guard de comportamiento
// ------------------------------------------------------------
// Aislamiento multiusuario del Pizarrón (artefacto): el workspaceArtifact
// queda sellado con el personId del participante activo y, al cambiar de
// usuario, se limpia para no mostrar el artefacto del usuario anterior.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useIntegrationStore } from '../src/store/integrationStore';

function makeArtifact() {
    return {
        id: 'ws-1',
        respuesta: '',
        titulo: 'Carta',
        tipo: 'text' as const,
        contenido: 'Querido amigo…',
        puntos_clave: [],
        origen: 'ia' as const,
        timestamp: Date.now(),
    };
}

describe('aislamiento multiusuario del artefacto del Pizarrón', () => {
    beforeEach(() => {
        useIntegrationStore.getState().reset();
    });

    it('sella el workspaceArtifact con el personId del participante activo', () => {
        useIntegrationStore.getState().setActivePersonId('alice');
        useIntegrationStore.getState().setWorkspaceArtifact(makeArtifact());

        expect(useIntegrationStore.getState().workspaceArtifact?.personId).toBe('alice');
    });

    it('limpia el workspaceArtifact al cambiar de participante activo', () => {
        useIntegrationStore.getState().setActivePersonId('alice');
        useIntegrationStore.getState().setWorkspaceArtifact(makeArtifact());
        expect(useIntegrationStore.getState().workspaceArtifact).not.toBeNull();

        useIntegrationStore.getState().setActivePersonId('bob');

        expect(useIntegrationStore.getState().workspaceArtifact).toBeNull();
        expect(useIntegrationStore.getState().activePersonId).toBe('bob');
    });
});
