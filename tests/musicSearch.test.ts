// ============================================================
// musicSearch — Pruebas unitarias de la búsqueda en línea de
// canciones vía Deezer (vistas previas ~30s).
// El cliente HTTP y la sonda de transmisibilidad son inyectables:
// aquí se usan fakes, sin red.
// ============================================================
import { describe, test, expect, vi } from 'vitest';
import { searchSongOnline, type MusicSearchClient, type StreamProbe } from '../src/services/musicSearch';

interface DeezerItem {
    id?: string | number;
    title?: string;
    preview?: string;
}

const makeClient = (data: DeezerItem[] = []): MusicSearchClient => ({
    searchJson: vi.fn(async () => ({ data })),
});

const okProbe: StreamProbe = vi.fn(async () => true);

describe('musicSearch — searchSongOnline', () => {
    // vi.fn() conserva el historial de llamadas entre tests; lo limpiamos
    // para que la sonda compartida (okProbe) no arrastre llamadas de otros tests.
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('devuelve la primera coincidencia con preview transmisible', async () => {
        const client = makeClient([
            { id: 'a', title: 'Canción A', preview: 'https://cdnt-preview.dzcdn.net/stream/a-1-1.mp3' },
            { id: 'b', title: 'Canción B', preview: 'https://cdnt-preview.dzcdn.net/stream/b-1-1.mp3' },
        ]);
        const result = await searchSongOnline('cancion', client, okProbe);
        expect(result).toEqual({
            identifier: 'a',
            title: 'Canción A',
            url: 'https://cdnt-preview.dzcdn.net/stream/a-1-1.mp3',
        });
        expect(okProbe).toHaveBeenCalledWith('https://cdnt-preview.dzcdn.net/stream/a-1-1.mp3', 4000);
    });

    test('ignora ítems sin preview y devuelve null si ninguno tiene', async () => {
        const client = makeClient([
            { id: 'x', title: 'Solo texto' },
        ]);
        const result = await searchSongOnline('algo', client, okProbe);
        expect(result).toBeNull();
        expect(okProbe).not.toHaveBeenCalled();
    });

    test('consulta vacía devuelve null sin llamar al cliente ni a la sonda', async () => {
        const client = makeClient([{ id: 'a', title: 'A', preview: 'https://x/a.mp3' }]);
        const result = await searchSongOnline('   ', client, okProbe);
        expect(result).toBeNull();
        expect(client.searchJson).not.toHaveBeenCalled();
        expect(okProbe).not.toHaveBeenCalled();
    });

    test('descarta candidatos cuyo preview no transmite y devuelve el primero que sí', async () => {
        const probe = vi.fn(async (url: string) => url.includes('sano'));
        const client = makeClient([
            { id: 'caido', title: 'Nodo caído', preview: 'https://cdnt-preview.dzcdn.net/caido.mp3' },
            { id: 'sano', title: 'Nodo sano', preview: 'https://cdnt-preview.dzcdn.net/sano.mp3' },
        ]);
        const result = await searchSongOnline('cancion', client, probe);
        expect(result).toEqual({
            identifier: 'sano',
            title: 'Nodo sano',
            url: 'https://cdnt-preview.dzcdn.net/sano.mp3',
        });
        expect(probe).toHaveBeenCalledTimes(2);
    });

    test('si ningún candidato transmite devuelve null', async () => {
        const probe = vi.fn(async () => false);
        const client = makeClient([
            { id: 'c1', title: 'C1', preview: 'https://cdnt-preview.dzcdn.net/c1.mp3' },
            { id: 'c2', title: 'C2', preview: 'https://cdnt-preview.dzcdn.net/c2.mp3' },
        ]);
        const result = await searchSongOnline('cancion', client, probe);
        expect(result).toBeNull();
        expect(probe).toHaveBeenCalledTimes(2);
    });

    test('un error de sonda se trata como no transmisible y continúa', async () => {
        const probe = vi.fn(async () => {
            throw new Error('timeout');
        });
        const client = makeClient([
            { id: 'c1', title: 'C1', preview: 'https://cdnt-preview.dzcdn.net/c1.mp3' },
        ]);
        const result = await searchSongOnline('cancion', client, probe);
        expect(result).toBeNull();
    });
});
