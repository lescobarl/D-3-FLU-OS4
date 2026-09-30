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

/** Predicado y marcas de la regla (extraidos para poder probar el DETECTOR, P2.4). */
const clearDeImagenPorTurno = (src: string): string[] =>
    src
        .split(/\r?\n/)
        .filter((line) => /workspaceImage\.clear\(/.test(line) && !line.includes('`'));

const MARCAS_APP_TURNO = [
    'integrationStore.setWorkspaceArtifact(null);',
    'const turnKind = resolveTurnArtifactKind(workspace?.tipo, navegacion?.comando);',
    'setTurnFocus({ kind: turnKind, seq: turnFocusSeqRef.current });',
];

const PROHIBIDOS_APP_TURNO = ["turnKind === 'image'", 'const focusKindNow'];

describe('P2.4 turnArtifactKindPerTurn - el detector no es decorativo', () => {
    it('marca la limpieza de imagen y la marca ausente en un App sintetico', () => {
        expect(clearDeImagenPorTurno('a\nworkspaceImage.clear()\nb')).toHaveLength(1);
        expect(clearDeImagenPorTurno('a\nb')).toHaveLength(0);
        const completo = [MARCAS_APP_TURNO[0], MARCAS_APP_TURNO[1], MARCAS_APP_TURNO[2]].join('\n');
        expect(MARCAS_APP_TURNO.every((m) => completo.includes(m))).toBe(true);
        expect(MARCAS_APP_TURNO[1].includes('resolveTurnArtifactKind')).toBe(true);
        expect(PROHIBIDOS_APP_TURNO.some((p) => completo.includes(p))).toBe(false);
    });
});

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
        expect(clearDeImagenPorTurno(APP_SRC)).toHaveLength(0);
    });

    it('el objeto de tipo artifact se reemplaza por su ruta unica, no por un guard de tipo', () => {
        // El artifact (objeto 'todo') si se limpia por turno: es el texto del turno.
        expect(APP_SRC).toContain(MARCAS_APP_TURNO[0]);
        // Y la limpieza NO puede depender de haber pedido imagen: eso era el bug.
        expect(APP_SRC).not.toContain(PROHIBIDOS_APP_TURNO[0]);
    });

    it('el tipo del turno sale del motor único (no recopiado en App)', () => {
        expect(APP_SRC).toContain(MARCAS_APP_TURNO[1]);
        expect(APP_SRC).toContain(MARCAS_APP_TURNO[2]);
        // La derivación vieja (tres copias del vocabulario en un ternario) no
        // puede volver: sería un segundo criterio de tipo.
        expect(APP_SRC).not.toContain(PROHIBIDOS_APP_TURNO[1]);
    });
});
