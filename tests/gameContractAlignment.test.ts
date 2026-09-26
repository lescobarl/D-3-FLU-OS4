// ============================================================
// gameContractAlignment - el campo `juego` del contrato
// ------------------------------------------------------------
// La IA entendia "juguemos/pon la loteria" pero NO tenia ningun campo
// en el contrato para arrancar la partida: respondia en texto y el motor
// local (src/core/games/*) nunca se disparaba. Mismo patron que el hueco
// de dominio de junta/cita.
//
// Fuente unica: la lista de gameId del prompt se deriva del GAME_CATALOG
// (nunca hardcodeada) y normalizeJuego valida antes de applyGameAction.
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildCapabilitiesPrompt, CAPABILITY_IDS } from '../src/services/capabilities';
import { GAME_CATALOG, gameDisplayName } from '../src/core/games/gameCatalog';

describe('capacidades - el juego es una capacidad real del contrato', () => {
    it('declara la capacidad juego', () => {
        expect(CAPABILITY_IDS).toContain('juego');
    });

    it('el prompt (es) obliga a emitir el campo juego con gameId+action', () => {
        const prompt = buildCapabilitiesPrompt('es');
        expect(prompt).toContain('REGLA DE JUEGOS OBLIGATORIA');
        expect(prompt).toContain('"juego"');
        expect(prompt).toContain('gameId');
        expect(prompt).toContain('"start"');
    });

    it('el prompt (en) trae la misma regla', () => {
        const prompt = buildCapabilitiesPrompt('en');
        expect(prompt).toContain('MANDATORY GAME RULE');
        expect(prompt).toContain('gameId');
        expect(prompt).toContain('"start"');
    });

    it('los gameId del prompt salen del catalogo (sin hardcode)', () => {
        for (const lang of ['es', 'en'] as const) {
            const prompt = buildCapabilitiesPrompt(lang);
            for (const game of GAME_CATALOG) {
                expect(prompt).toContain(`${game.id} (${gameDisplayName(game)})`);
            }
        }
    });

    it('con partida activa la respuesta del jugador va como turn+playerText', () => {
        const prompt = buildCapabilitiesPrompt('es');
        expect(prompt).toContain('PARTIDA ACTIVA');
        expect(prompt).toContain('"turn"');
        expect(prompt).toContain('playerText');
    });
});
