// ============================================================
// fluStorage.test.ts — Caracterización + invariantes de la capa de voz
// ------------------------------------------------------------
// Fija el comportamiento observable de fluStorage (IDB cruda) antes y
// después de migrar a `flu-os3` (F4). Verifica:
//   - voice_profiles: guardar, listar, buscar por label, borrar (no visible)
//   - session_state: guardar y recuperar el historial
// El borrado se valida por VISIBILIDAD (no por ausencia física), de modo
// que seguirá siendo correcto cuando el borrado sea lógico (§2.9).
// ============================================================

import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

describe('fluStorage — perfiles de voz y sesión', () => {
    it('guarda, lista, busca por label y borra un perfil', async () => {
        const storage = await import('../src/voice/lib/fluStorage');

        const saved = await storage.saveVoiceProfile({ label: 'Ana', signature: [1, 2, 3] });
        expect(saved.id).toBeTruthy();
        expect(saved.label).toBe('Ana');

        const listed = await storage.listVoiceProfiles();
        expect(listed.map((p) => p.label)).toContain('Ana');

        const found = await storage.findVoiceProfileByLabel('Ana');
        expect(found?.id).toBe(saved.id);

        const removed = await storage.deleteVoiceProfile(saved.id);
        expect(removed).toBe(true);

        const after = await storage.listVoiceProfiles();
        expect(after.some((p) => p.id === saved.id)).toBe(false);
        expect(await storage.findVoiceProfileByLabel('Ana')).toBeNull();
    });

    it('guarda y recupera el estado de sesión con historial', async () => {
        const storage = await import('../src/voice/lib/fluStorage');

        await storage.saveSessionState({ history: [{ text: 'hola' }], language: 'es' });
        const loaded = await storage.loadSessionState();

        expect(loaded).toBeTruthy();
        expect(Array.isArray(loaded?.history)).toBe(true);
        expect(loaded?.language).toBe('es');
    });
});
