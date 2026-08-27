// ============================================================
// turnSpeakerCommit — diarización al FINAL (una sola resolución).
// Prioridad: asr-revision → replace-last-locked → wake-intro →
// explicit-next → segment-chrono-split → preflight-audio → pinned → sticky.
// NOTA: el sticky prefiere stickyFallback sobre lastLogged; por eso los
// tests sticky pasan stickyFallback:'' para no enmascarar lastLogged.
// ============================================================
// Los argumentos de opciones se castean a `any`: el módulo es JS sin
// checkJs y TS infiere tipos demasiado estrechos de los parámetros con
// default (preflight=null, clusters=[], lastSignature=null). El test
// valida comportamiento en runtime, no el shape de tipos inferido.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
    resolveTurnSpeakerAtCommit,
    resolveCommitRowSignature,
    applyResolvedSpeakerToSessionRefs,
} from '../src/voice/lib/turnSpeakerCommit.js';

describe('turnSpeakerCommit — asr-revision y replace-last-locked', () => {
    it('sameRevisionReplace → asr-revision con sessionPrimary', () => {
        const r = resolveTurnSpeakerAtCommit({
            phrase: 'hola',
            sameRevisionReplace: true,
            sessionPrimary: 'Hablante 2',
        } as any);
        expect(r).toEqual({
            speakerId: 'speaker_2',
            speakerName: 'Hablante 2',
            source: 'asr-revision',
        });
    });

    it('sameRevisionReplace cae a lastLogged sin sessionPrimary', () => {
        const r = resolveTurnSpeakerAtCommit({
            phrase: 'hola',
            sameRevisionReplace: true,
            sessionPrimary: '',
            lastLogged: 'Hablante 3',
        } as any);
        expect(r).toEqual({
            speakerId: 'speaker_3',
            speakerName: 'Hablante 3',
            source: 'asr-revision',
        });
    });

    it('preserveSpeakerOnReplace → replace-last-locked', () => {
        const r = resolveTurnSpeakerAtCommit({
            phrase: 'hola',
            preserveSpeakerOnReplace: 'Hablante 2',
        } as any);
        expect(r).toEqual({
            speakerId: 'speaker_2',
            speakerName: 'Hablante 2',
            source: 'replace-last-locked',
        });
    });
});

describe('turnSpeakerCommit — wake-intro y explicit-next', () => {
    it('«ok flu soy Luis» con wakeWords → wake-intro / Luis', () => {
        const r = resolveTurnSpeakerAtCommit({
            phrase: 'ok flu soy Luis',
            wakeWords: ['ok flu'],
        } as any);
        expect(r).toEqual({
            speakerId: 'speaker_name_luis',
            speakerName: 'Luis',
            source: 'wake-intro',
        });
    });

    it('«ahora habla otra persona» con Hablante 1 → explicit-next / Hablante 2', () => {
        const r = resolveTurnSpeakerAtCommit({
            phrase: 'ahora habla otra persona',
            knownSpeakerLabels: ['Hablante 1'],
        } as any);
        expect(r).toEqual({
            speakerId: 'speaker_2',
            speakerName: 'Hablante 2',
            source: 'explicit-next',
        });
    });
});

describe('turnSpeakerCommit — preflight-audio', () => {
    it('preflight listo y distinto de lastLogged → preflight-audio (sin chrono-split)', () => {
        const r = resolveTurnSpeakerAtCommit({
            phrase: 'este es un mensaje lo bastante largo para evitar heurísticas',
            preflight: { ready: true, speakerId: 'X2', speakerName: 'Hablante 2' },
            lastLogged: 'Hablante 1',
        } as any);
        expect(r.speakerId).toBe('X2');
        expect(r.speakerName).toBe('Hablante 2');
        expect(r.source).toBe('preflight-audio');
    });
});

describe('turnSpeakerCommit — pinned y sticky', () => {
    it('pinnedSpeaker → pinned', () => {
        const r = resolveTurnSpeakerAtCommit({ phrase: 'hola', pinnedSpeaker: 'Luis' } as any);
        expect(r).toEqual({
            speakerId: 'speaker_name_luis',
            speakerName: 'Luis',
            source: 'pinned',
        });
    });

    it('sticky conserva lastLogged con stickyFallback vacío', () => {
        const r = resolveTurnSpeakerAtCommit({
            phrase: 'hola',
            stickyFallback: '',
            lastLogged: 'Hablante 3',
        } as any);
        expect(r.speakerName).toBe('Hablante 3');
        expect(r.source).toBe('sticky');
    });

    it('preflight pendiente → sticky-preflight-pending', () => {
        const r = resolveTurnSpeakerAtCommit({
            phrase: 'hola',
            stickyFallback: '',
            lastLogged: 'Hablante 3',
            preflight: { ready: false, pending: true },
        } as any);
        expect(r.speakerName).toBe('Hablante 3');
        expect(r.source).toBe('sticky-preflight-pending');
    });
});

describe('turnSpeakerCommit — resolveCommitRowSignature', () => {
    it('usa signatureVector del resolved primero', () => {
        const sig = resolveCommitRowSignature({ resolved: { signatureVector: [0.1, 0.2] } } as any);
        expect(sig).toEqual([0.1, 0.2]);
    });

    it('usa preflight.signatureVector cuando resolved no trae', () => {
        const sig = resolveCommitRowSignature({
            resolved: {},
            preflight: { ready: true, signatureVector: [0.3, 0.4] },
        } as any);
        expect(sig).toEqual([0.3, 0.4]);
    });

    it('busca el cluster cuando el preflight no está listo', () => {
        const sig = resolveCommitRowSignature({
            resolved: { speakerName: 'Hablante 2' },
            preflight: { ready: false },
            clusters: [{ speakerId: 'X2', label: 'Hablante 2', signature: [0.5, 0.6] }],
        } as any);
        expect(sig).toEqual([0.5, 0.6]);
    });

    it('cae al lastSignature', () => {
        const sig = resolveCommitRowSignature({
            resolved: {},
            preflight: null,
            clusters: [],
            lastSignature: [0.7],
        } as any);
        expect(sig).toEqual([0.7]);
    });

    it('retorna null sin fuentes de firma', () => {
        const sig = resolveCommitRowSignature({
            resolved: {},
            preflight: null,
            clusters: [],
            lastSignature: null,
        } as any);
        expect(sig).toBeNull();
    });
});

describe('turnSpeakerCommit — applyResolvedSpeakerToSessionRefs', () => {
    it('aplica nombre y clusters a las refs de sesión', () => {
        const refs = {
            lastSpeakerRef: { current: '' },
            lastLoggedSpeakerRef: { current: '' },
            sessionPrimarySpeakerRef: { current: '' },
            speakerClustersRef: { current: [] },
        };
        applyResolvedSpeakerToSessionRefs(
            { speakerName: 'Luis', workingClusters: [{ label: 'Luis' }] } as any,
            refs as any,
        );
        expect(refs.lastSpeakerRef.current).toBe('Luis');
        expect(refs.lastLoggedSpeakerRef.current).toBe('Luis');
        expect(refs.sessionPrimarySpeakerRef.current).toBe('Luis');
        expect(refs.speakerClustersRef.current).toEqual([{ label: 'Luis' }]);
    });

    it('no-op con nombre vacío', () => {
        const refs = {
            lastSpeakerRef: { current: '' },
            sessionPrimarySpeakerRef: { current: 'Hablante 1' },
        };
        applyResolvedSpeakerToSessionRefs({ speakerName: '' } as any, refs as any);
        expect(refs.lastSpeakerRef.current).toBe('');
        expect(refs.sessionPrimarySpeakerRef.current).toBe('Hablante 1');
    });
});
