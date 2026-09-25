// ============================================================
// musicCapabilities — Pruebas unitarias de los módulos F3
//   - musicPlayer.ts  (playlist única + reproductor HTMLAudio + playSong)
//   - musicSearch.ts  (búsqueda en línea vía Deezer, cliente inyectable)
//   - capabilities.ts (catálogo honesto de capacidades para el prompt)
// Objetivo: validar que NO hay hardcode (playlist = única fuente de
// verdad) y que el prompt solo expone capacidades reales del contrato.
// ============================================================
import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
    FLU_PLAYLIST,
    getPlaylist,
    resolveTrack,
    findTrack,
    normalizeForMatch,
} from '../src/services/musicPlayer';
import type { MusicSearchClient } from '../src/services/musicSearch';
import {
    FLU_CAPABILITIES,
    CAPABILITY_IDS,
    buildCapabilitiesPrompt,
} from '../src/services/capabilities';

// --- Mock de HTMLAudioElement (musicPlayer usa `new Audio()` como singleton) ---
interface MockAudioLike {
    src: string;
    preload: string;
    loop: boolean;
    volume: number;
    paused: boolean;
    ended: boolean;
    currentTime: number;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    dispatchEvent: ReturnType<typeof vi.fn>;
}

const audioInstances: MockAudioLike[] = [];

type MockAudioEvent = () => void;

class MockAudio {
    src = '';
    preload = '';
    loop = false;
    volume = 1;
    paused = true;
    ended = false;
    currentTime = 0;
    play = vi.fn(() => {
        this.paused = false;
        return Promise.resolve();
    });
    pause = vi.fn(() => {
        this.paused = true;
    });
    private listeners = new Map<string, MockAudioEvent[]>();
    addEventListener = vi.fn((type: string, cb: MockAudioEvent) => {
        const arr = this.listeners.get(type) ?? [];
        arr.push(cb);
        this.listeners.set(type, arr);
    });
    dispatchEvent = vi.fn((type: string) => {
        for (const cb of this.listeners.get(type) ?? []) cb();
    });

    constructor() {
        audioInstances.push(this);
    }
}

beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('Audio', MockAudio);
});

const audio = (): MockAudioLike => audioInstances[0];

describe('musicPlayer — FLU_PLAYLIST (única fuente de verdad, sin hardcode)', () => {
    test('tiene 9 pistas con ids y títulos únicos', () => {
        expect(FLU_PLAYLIST).toHaveLength(9);
        const ids = FLU_PLAYLIST.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        const titles = FLU_PLAYLIST.map((t) => t.title);
        expect(new Set(titles).size).toBe(titles.length);
    });

    test('todas las pistas usan URLs http(s) válidas', () => {
        for (const t of FLU_PLAYLIST) {
            expect(t.url).toMatch(/^https?:\/\/.+/);
        }
    });

    test('getPlaylist devuelve copias (mutar la copia no toca el original)', () => {
        const copy = getPlaylist();
        copy[0].id = 'mutado';
        expect(FLU_PLAYLIST[0].id).not.toBe('mutado');
        expect(getPlaylist()).not.toBe(FLU_PLAYLIST);
    });
});

describe('musicPlayer — resolveTrack', () => {
    test('sin argumento devuelve la primera pista', () => {
        expect(resolveTrack()?.id).toBe(FLU_PLAYLIST[0].id);
    });

    test('resuelve por id exacto', () => {
        expect(resolveTrack('fiesta')?.id).toBe('fiesta');
        expect(resolveTrack('sueño')?.id).toBe('sueño');
    });

    test('resuelve por subtítulo parcial e insensible a mayúsculas', () => {
        expect(resolveTrack('baila bunny')?.id).toBe('baila');
        expect(resolveTrack('FIESTA')?.id).toBe('fiesta');
        expect(resolveTrack('Canta')?.id).toBe('canta');
    });

    test('resuelve insensible a acentos (cumpleanos, mananitas, estrellita)', () => {
        expect(resolveTrack('cumpleanos')?.id).toBe('cumpleaños');
        expect(resolveTrack('Cumpleaños Feliz')?.id).toBe('cumpleaños');
        expect(resolveTrack('mananitas')?.id).toBe('mañanitas');
        expect(resolveTrack('estrellita')?.id).toBe('estrellita');
        expect(resolveTrack('elisa')?.id).toBe('elisa');
    });

    test('id desconocido cae a la primera pista', () => {
        expect(resolveTrack('no-existe')?.id).toBe(FLU_PLAYLIST[0].id);
    });
});

describe('musicPlayer — findTrack (sin fallback) y normalizeForMatch', () => {
    test('normalizeForMatch quita acentos, mayúsculas y espacios', () => {
        expect(normalizeForMatch('Cumpleaños')).toBe('cumpleanos');
        expect(normalizeForMatch('  Las Mañanitas  ')).toBe('las mananitas');
        expect(normalizeForMatch('ESTRELLITA')).toBe('estrellita');
    });

    test('findTrack devuelve undefined si no hay coincidencia (sin fallback)', () => {
        expect(findTrack('no-existe')).toBeUndefined();
        expect(findTrack()).toBeUndefined();
        expect(findTrack('cumpleanos')?.id).toBe('cumpleaños');
        expect(findTrack('las mananitas')?.id).toBe('mañanitas');
    });
});

describe('musicPlayer — playMusic/pause/stop/volume', () => {
    // musicPlayer guarda un singleton `audioRef` a nivel de módulo;
    // reimportamos con resetModules() para que cada caso parta con
    // audioRef === null (aislamiento real del estado).
    let mp: typeof import('../src/services/musicPlayer');

    beforeEach(async () => {
        vi.resetModules();
        audioInstances.length = 0;
        mp = await import('../src/services/musicPlayer');
    });

    test('playMusic sin opciones reproduce la primera pista', () => {
        mp.playMusic();
        expect(audio().src).toBe(mp.FLU_PLAYLIST[0].url);
        expect(audio().play).toHaveBeenCalledTimes(1);
        expect(mp.isMusicPlaying()).toBe(true);
    });

    test('playMusic con cancion resuelve a la URL de esa pista (sin hardcode de URL)', () => {
        mp.playMusic({ trackId: 'fiesta' });
        expect(audio().src).toBe('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3');
        expect(audio().src).toBe(mp.FLU_PLAYLIST[3].url);
    });

    test('playMusic aplica volume y loop', () => {
        mp.playMusic({ trackId: 'canta', volume: 0.3, loop: true });
        expect(audio().volume).toBe(0.3);
        expect(audio().loop).toBe(true);
    });

    test('pauseMusic pausa; resumeMusic reanuda', () => {
        mp.playMusic();
        mp.pauseMusic();
        expect(audio().paused).toBe(true);
        expect(mp.isMusicPlaying()).toBe(false);
        mp.resumeMusic();
        expect(audio().play).toHaveBeenCalledTimes(2);
        expect(mp.isMusicPlaying()).toBe(true);
    });

    test('stopMusic pausa y reinicia a 0', () => {
        mp.playMusic();
        audio().currentTime = 42;
        mp.stopMusic();
        expect(audio().paused).toBe(true);
        expect(audio().currentTime).toBe(0);
    });

    test('setMusicVolume ajusta el volumen', () => {
        mp.playMusic();
        mp.setMusicVolume(0.4);
        expect(audio().volume).toBe(0.4);
    });

    test('pause/stop/resume/volume sin audio iniciado son inofensivos', () => {
        // audioRef === null (módulo fresco): nada debe lanzar.
        expect(() => mp.pauseMusic()).not.toThrow();
        expect(() => mp.stopMusic()).not.toThrow();
        expect(() => mp.resumeMusic()).not.toThrow();
        expect(() => mp.setMusicVolume(0.5)).not.toThrow();
        expect(mp.isMusicPlaying()).toBe(false);
    });
});

describe('musicPlayer — playSong (catálogo → en línea → not_found honesto)', () => {
    let mp: typeof import('../src/services/musicPlayer');

    const makeClient = (
        data: Array<{ id?: string | number; title?: string; preview?: string }> = [],
    ): MusicSearchClient => ({
        searchJson: vi.fn(async () => ({ data })),
    });

    beforeEach(async () => {
        vi.resetModules();
        audioInstances.length = 0;
        mp = await import('../src/services/musicPlayer');
    });

    test('canción del catálogo suena al instante (source catalog)', async () => {
        const probe = vi.fn(async () => true);
        const result = await mp.playSong('cumpleanos', undefined, probe);
        expect(result.source).toBe('catalog');
        expect(result.title).toBe('Cumpleaños Feliz');
        expect(audio().src).toBe(
            mp.FLU_PLAYLIST.find((t) => t.id === 'cumpleaños')?.url,
        );
        expect(mp.isMusicPlaying()).toBe(true);
        expect(probe).toHaveBeenCalledTimes(1);
    });

    test('canción desconocida se busca en línea y suena en streaming (source online)', async () => {
        const client = makeClient([
            {
                id: '123',
                title: 'Canción Rara',
                preview: 'https://cdnt-preview.dzcdn.net/stream/123-1-1.mp3',
            },
        ]);
        const probe = vi.fn(async () => true);
        const result = await mp.playSong('una cancion rara', client, probe);
        expect(result.source).toBe('online');
        expect(result.title).toBe('Canción Rara');
        expect(audio().src).toBe('https://cdnt-preview.dzcdn.net/stream/123-1-1.mp3');
        expect(audio().loop).toBe(false); // FIX 2026-08-17: la preview suena UNA vez y termina sola
        expect(client.searchJson).toHaveBeenCalledTimes(1);
        expect(probe).toHaveBeenCalledTimes(1);
    });

    test('búsqueda sin resultados reproducibles NO reproduce nada (source not_found)', async () => {
        const client = makeClient([]);
        const probe = vi.fn(async () => false);
        const result = await mp.playSong('cancion inexistente', client, probe);
        expect(result.source).toBe('not_found');
        expect(result.title).toBe('');
        expect(audioInstances.length).toBe(0);
    });

    test('playMusicUrl reproduce una URL directa en línea', () => {
        mp.playMusicUrl('https://example.com/song.mp3');
        expect(audio().src).toBe('https://example.com/song.mp3');
        expect(mp.isMusicPlaying()).toBe(true);
    });

    test('auto-recuperación: si el stream en línea se corta (error), reinicia para seguir cantando', async () => {
        vi.useFakeTimers();
        try {
            const client = makeClient([
                { id: '9', title: 'Canción X', preview: 'https://cdnt-preview.dzcdn.net/stream/9-1-1.mp3' },
            ]);
            await mp.playSong('cancion x', client, vi.fn(async () => true));
            const plays = audio().play as ReturnType<typeof vi.fn>;
            expect(audio().loop).toBe(false); // FIX 2026-08-17: sin loop infinito
            expect(plays).toHaveBeenCalledTimes(1);
            // Primer error: bloqueado por el gap anti-bucle (3 s).
            audio().dispatchEvent('error');
            expect(plays).toHaveBeenCalledTimes(1);
            // Pasado el gap, el siguiente error reinicia el stream.
            vi.advanceTimersByTime(3100);
            audio().dispatchEvent('error');
            expect(plays).toHaveBeenCalledTimes(2);
            // Tras "para la música" la auto-recuperación queda desactivada.
            mp.stopMusic();
            vi.advanceTimersByTime(3100);
            audio().dispatchEvent('error');
            expect(plays).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('capabilities — catálogo honesto', () => {
    test('FLU_CAPABILITIES expone 8 capacidades y CAPABILITY_IDS coincide', () => {
        expect(FLU_CAPABILITIES).toHaveLength(8);
        expect(CAPABILITY_IDS).toEqual(FLU_CAPABILITIES.map((c) => c.id));
        expect(CAPABILITY_IDS).toContain('play_music');
        expect(CAPABILITY_IDS).toContain('buscar_cancion');
        expect(CAPABILITY_IDS).toContain('acciones');
    });

    test('buildCapabilitiesPrompt(es) lista play_music, todo el playlist y la guardia de honestidad', () => {
        const prompt = buildCapabilitiesPrompt('es');
        expect(prompt).toContain('play_music');
        expect(prompt).toContain('CAPACIDADES DE FLU');
        for (const t of FLU_PLAYLIST) {
            expect(prompt).toContain(t.id);
            expect(prompt).toContain(t.title);
        }
        expect(prompt).toContain('no puedes navegar por internet');
        expect(prompt).toContain('buscar_cancion');
        expect(prompt).toContain('NO inventes otras');
        expect(prompt).toContain('REGLA DE ACCIONES (OBLIGATORIA)');
        expect(prompt).toContain('"acciones"');
    });

    test('buildCapabilitiesPrompt(en) usa cabecera y guardia en inglés con el mismo playlist', () => {
        const prompt = buildCapabilitiesPrompt('en');
        expect(prompt).toContain('FLU CAPABILITIES');
        expect(prompt).toContain('cannot browse');
        expect(prompt).toContain('buscar_cancion');
        expect(prompt).toContain('do NOT invent');
        expect(prompt).toContain('ACCIONES RULE (MANDATORY)');
        expect(prompt).toContain('"acciones"');
        for (const t of FLU_PLAYLIST) {
            expect(prompt).toContain(t.id);
            expect(prompt).toContain(t.title);
        }
    });

    test('cada capacidad tiene descripciones es/en no vacías', () => {
        for (const c of FLU_CAPABILITIES) {
            expect(c.descriptionEs.length).toBeGreaterThan(10);
            expect(c.descriptionEn.length).toBeGreaterThan(10);
        }
    });
});
