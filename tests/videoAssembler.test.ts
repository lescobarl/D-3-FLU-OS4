// ============================================================
// videoAssembler.test.ts — ensamblado de video "walkthrough" (F4)
// ============================================================
// Cubre: descomposición del guion en storyboard, estimación de
// duración, helpers puros de frame (wrapText/describeFrame) y el
// modo degradado de assembleVideo (ffmpeg.wasm no carga en vitest
// → siempre degraded=true en el entorno de pruebas).
// ============================================================

import { describe, test, expect } from 'vitest';
import {
    buildStoryboardFromScript,
    estimateVideoDuration,
    assembleVideo,
    wrapText,
    describeFrame,
} from '../src/services/videoAssembler';

describe('videoAssembler — buildStoryboardFromScript', () => {
    test('divide el guion en secciones con narración inicial', () => {
        const storyboard = buildStoryboardFromScript(
            'Narración inicial\n# Sección 1\nNarración de la sección 1'
        );
        expect(storyboard).toHaveLength(2);
        expect(storyboard[0].title).toBe('Introducción');
        expect(storyboard[0].narration).toBe('Narración inicial');
        expect(storyboard[0].durationSec).toBeGreaterThanOrEqual(3);
        expect(storyboard[1].title).toBe('Sección 1');
        expect(storyboard[1].narration).toBe('Narración de la sección 1');
    });

    test('guion vacío produce una sola diapositiva de introducción', () => {
        const storyboard = buildStoryboardFromScript('');
        expect(storyboard).toHaveLength(1);
        expect(storyboard[0].title).toBe('Introducción');
        expect(storyboard[0].narration).toBe('');
    });

    test('admite títulos con hasta tres niveles de heading', () => {
        const storyboard = buildStoryboardFromScript('# Título 1\n## Título 2\n### Título 3');
        expect(storyboard.map((s) => s.title)).toEqual([
            'Introducción',
            'Título 1',
            'Título 2',
            'Título 3',
        ]);
    });
});

describe('videoAssembler — estimateVideoDuration', () => {
    test('usa duracion_min en segundos cuando está definida', () => {
        const storyboard = [{ title: 'A', narration: '', durationSec: 3 }];
        expect(estimateVideoDuration(storyboard, { duracion_min: 2 })).toBe(120);
    });

    test('suma la duración de las diapositivas', () => {
        const storyboard = [
            { title: 'A', narration: '', durationSec: 3 },
            { title: 'B', narration: '', durationSec: 5 },
        ];
        expect(estimateVideoDuration(storyboard, {})).toBe(8);
    });

    test('aplica un mínimo de 5 segundos', () => {
        expect(estimateVideoDuration([], {})).toBe(5);
        expect(estimateVideoDuration([{ title: 'A', narration: '', durationSec: 1 }], {})).toBe(5);
    });
});

describe('videoAssembler — wrapText', () => {
    test('envuelve líneas respetando el ancho máximo', () => {
        const lines = wrapText('uno dos tres cuatro cinco seis siete ocho nueve diez', 12);
        expect(lines.length).toBeGreaterThan(1);
        expect(lines.every((l) => l.length <= 12)).toBe(true);
    });

    test('conserva saltos de párrafo', () => {
        const lines = wrapText('primera línea\nsegunda línea', 50);
        expect(lines).toEqual(['primera línea', 'segunda línea']);
    });

    test('texto vacío produce cero líneas', () => {
        expect(wrapText('', 20)).toEqual([]);
    });
});

describe('videoAssembler — describeFrame', () => {
    const item = { title: 'Introducción', narration: 'Narración de ejemplo para el frame.', durationSec: 5 };

    test('usa el tema por defecto y ajusta la narración', () => {
        const frame = describeFrame(item, {});
        expect(frame.title).toBe('Introducción');
        expect(frame.narration).toContain('Narración');
        expect(frame.lines.length).toBeGreaterThan(0);
        expect(frame.bg).toBeTruthy();
        expect(frame.fg).toBeTruthy();
    });

    test('aplica una paleta de tema conocida (azul)', () => {
        const frame = describeFrame(item, { tema: 'azul' });
        expect(frame.bg).toBe('#0b2447');
    });

    test('tema desconocido cae a default', () => {
        const frame = describeFrame(item, { tema: 'inexistente' as any });
        expect(frame.bg).toBe('#1a1a2e');
    });
});

describe('videoAssembler — assembleVideo (modo degradado)', () => {
    test('devuelve guion/storyboard y degraded=true sin ffmpeg', async () => {
        const script = '# Mi video\nNarración principal';
        const result = await assembleVideo(script, { duracion_min: 1 });
        expect(result.degraded).toBe(true);
        expect(result.script).toBe(script);
        expect(result.storyboard.length).toBeGreaterThan(0);
        expect(result.estimatedSeconds).toBe(60);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.url).toBeUndefined();
    });

    test('sin duracion_min estima por narración', async () => {
        const result = await assembleVideo('# Mi video\nNarración principal', {});
        expect(result.degraded).toBe(true);
        expect(result.estimatedSeconds).toBeGreaterThanOrEqual(5);
        expect(result.storyboard.length).toBeGreaterThan(0);
    });
});
