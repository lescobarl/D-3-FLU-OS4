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
    it('NINGUN turno limpia la imagen a mano: la invalida su ruta unica', () => {
        // P7.62 (medido): limpiar la imagen en cada turno borraba el ULTIMO objeto
        // de su tipo (una carta de la partida, una respuesta, se llevaban por
        // delante la imagen recien generada). El arreglo no fue acotar la limpieza
        // con un guard, fue QUITARLA: su ruta unica (generateFromContract ->
        // beginImageRequest) ya invalida la anterior. Este test falsa la vuelta
        // atras: si reaparece una limpieza por turno, cae.
        const clearCalls = APP_SRC.split(/\r?\n/).filter(
            (line) => /workspaceImage\.clear\(/.test(line) && !line.includes('`'),
        );
        expect(clearCalls).toHaveLength(0);
    });

    it('el objeto de tipo artifact se reemplaza por su ruta unica, no por un guard de tipo', () => {
        // El artifact (objeto 'todo') si se limpia por turno: es el texto del turno.
        expect(APP_SRC).toContain('integrationStore.setWorkspaceArtifact(null);');
        // Y la limpieza NO puede depender de haber pedido imagen: eso era el bug.
        expect(APP_SRC).not.toContain('turnKind === \'image\'');
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
