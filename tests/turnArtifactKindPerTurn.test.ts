// ============================================================
// turnArtifactKindPerTurn — el turno solo reemplaza el objeto de SU tipo
// ------------------------------------------------------------
// Invariante: el último objeto de cada tipo del Pizarrón (video / imagen /
// todo) NO se borra por un turno de otro tipo. La limpieza por turno de App
// se acota con `resolveTurnArtifactKind`, el mismo criterio que mueve el foco
// del feed: motor puro con estos casos + barrera de cableado sobre App.tsx
// (si la limpieza dejara de consultarlo, el guard cae).
// ============================================================
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTurnArtifactKind } from '../src/lib/turnArtifactKind';

const APP_SRC = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');

describe('resolveTurnArtifactKind — tipo de objeto que produce el turno', () => {
    it('un tipo visual produce una imagen', () => {
        expect(resolveTurnArtifactKind('image_prompt', undefined)).toBe('image');
        expect(resolveTurnArtifactKind('diagram', undefined)).toBe('image');
        expect(resolveTurnArtifactKind('3d', undefined)).toBe('image');
        // El tipo llega crudo del contrato: se normaliza (trim + minúsculas).
        expect(resolveTurnArtifactKind('  IMAGE_PROMPT  ', undefined)).toBe('image');
    });

    it('el comando de navegación produce el tipo sin contrato', () => {
        expect(resolveTurnArtifactKind(undefined, 'GENERAR_VIDEO')).toBe('video');
        expect(resolveTurnArtifactKind(undefined, 'GENERAR_DOCUMENTO')).toBe('doc');
    });

    it('el tipo del contrato manda sobre el comando', () => {
        expect(resolveTurnArtifactKind('video', undefined)).toBe('video');
        expect(resolveTurnArtifactKind('doc', undefined)).toBe('doc');
    });

    it('una respuesta conversacional no produce objeto propio (todo)', () => {
        expect(resolveTurnArtifactKind('text', undefined)).toBe('text');
        expect(resolveTurnArtifactKind(undefined, undefined)).toBe('text');
        expect(resolveTurnArtifactKind(null, null)).toBe('text');
        expect(resolveTurnArtifactKind('horario', undefined)).toBe('text');
    });
});

describe('App — la limpieza por turno está acotada al tipo del turno', () => {
    it('solo limpia la imagen el turno que SÍ pide una imagen', () => {
        // Llamadas reales al hook (se descartan los mensajes de log, que citan
        // el mismo texto dentro de un template).
        const clearLines = APP_SRC.split(/\r?\n/).filter(
            (line) => line.includes('workspaceImage.clear();') && !line.includes('`'),
        );
        expect(clearLines.length).toBeGreaterThan(0);
        // Cada limpieza vive dentro del guard de tipo; sin guard, un turno de
        // texto (una carta de la partida, una respuesta) borraba la imagen
        // recién generada, que es el último objeto de su tipo.
        for (const line of clearLines) {
            expect(line).toContain("turnKind === 'image'");
        }
    });

    it('el tipo del turno sale del motor único (no recopiado en App)', () => {
        expect(APP_SRC).toContain(
            'const turnKind = resolveTurnArtifactKind(workspace?.tipo, navegacion?.comando);',
        );
        expect(APP_SRC).toContain('setTurnFocus({ kind: turnKind, seq: turnFocusSeqRef.current });');
        // La derivación vieja (tres copias del vocabulario en un ternario) no
        // puede volver: sería un segundo criterio de tipo.
        expect(APP_SRC).not.toContain('const focusKindNow');
    });
});
