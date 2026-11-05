// ============================================================
// IDENTIDAD DE HABLANTE DE LA SESION
// ------------------------------------------------------------
// Defecto medido en la conversacion del dueno (2026-09-29): solo el PRIMER turno
// quedo con su nombre; el resto cayo a «Hablante 1». Causa: la presentacion por
// voz ("soy Luis") solo etiquetaba ESE turno (y guardaba el perfil de voz), pero
// NO fijaba el hablante primario de la sesion; los turnos siguientes iban sin
// `sessionPrimary` y el diarizador devolvia su etiqueta automatica.
//
// Invariante (MANDATO 2026-10-18): (a) el primario de sesion NO crea el ancla con la
// primera voz (podia ser la TV); con un ancla REGISTRADA preexistente y medida sostenida,
// TODOS los turnos de esa voz llevan su nombre; (b) el control inverso: una voz DISTINTA
// no hereda el nombre ni la etiqueta.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decidirIdentidad } from '../src/voice/conversation/identidad';
import { registerSpeakerIdentity } from '../src/voice/lib/speakerIdentityRegister';
import {
    clearSessionPrimarySpeaker,
    setSessionPrimarySpeaker,
} from '../src/voice/lib/sessionPrimarySpeaker';
import { compareCosineSignatures } from '../src/voice/lib/speakerCore';
import {
    forgetVoiceName,
    registerVoiceName,
    resetVoiceDirectory,
    resolveVoiceIdentity,
    resolveVoiceName,
} from '../src/voice/lib/speakerDirectory';
import { resolveSpeakerNameFromUtterance } from '../src/voice/lib/speakerPolicy';

const hookSource = () =>
    readFileSync(join(process.cwd(), 'src', 'voice', 'hooks', 'useFluVoiceAssistant.js'), 'utf8');

const ownerSource = () =>
    readFileSync(join(process.cwd(), 'src', 'voice', 'lib', 'speakerIdentityRegister.js'), 'utf8');

/**
 * El hook enruta la presentacion por voz al DUENO UNICO del REGISTRO del nombre
 * (`registerSpeakerIdentity`): ya no fija el primario por su cuenta, ni con
 * `setSessionPrimarySpeaker` ni escribiendo el ref a mano.
 */
export function hookRoutesPresentedToOwner(src: string): boolean {
    return /registerSpeakerIdentity\(\{\s*name: introducedName/.test(src);
}

/**
 * Quien fija el primario de una presentacion de voz es el DUENO del registro:
 * `setSessionPrimarySpeaker(refs?.sessionPrimarySpeakerRef, clean, source)` con
 * `source = 'presented'` por defecto (presented > participant > resolved).
 */
export function ownerSetsPresentedPrimary(src: string): boolean {
    return (
        /setSessionPrimarySpeaker\(refs\?\.sessionPrimarySpeakerRef,\s*clean,\s*source\)/.test(src) &&
        /source = ['"]presented['"]/.test(src)
    );
}

/** Escritores DIRECTOS del ref en un fuente (debe ser 0: el dueno es el modulo). */
export function directSessionPrimaryWrites(src: string): number {
    return (src.match(/sessionPrimarySpeakerRef\.current\s*=/g) || []).length;
}

const vozA = Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.1));
const vozB = Array.from({ length: 512 }, (_, i) => Math.cos(i * 0.37));

// Corte 2026-10-26: `resolveConversationSpeaker` (speakerDiarization) se retiro con la
// tuberia vieja. La identidad de la locucion la decide la REGLA DEL MODULO
// (`decidirIdentidad`, dueno unico de ingesta/cierre/resolucion pasiva): misma voz =
// coseno >= umbral contra la MEJOR plantilla de la sesion (mandato 2026-10-30: no
// solo la ultima voz). El primario NO participa.
const ids = (() => {
    let n = 0;
    return { next: () => `uuid-turno-${(n += 1)}` };
})();

const decidirTurno = (
    vector: number[],
    plantillas: ReadonlyArray<{ vozId: string; vector: number[]; etiqueta: string }>,
    etiquetaNueva: string,
) =>
    decidirIdentidad({
        vector,
        plantillas,
        // Mismo umbral del adaptador del modulo (cosineContinuityThreshold); con el
        // MISMO vector el coseno es 1.0: continua con cualquier umbral real <= 1.
        umbral: 0.8,
        etiquetaNueva: () => etiquetaNueva,
        // El coseno es el REAL del dueño (speakerCore.compareCosineSignatures).
        comparar: (a, b) => compareCosineSignatures([...a], [...b]),
        id: ids.next,
    });

/** Ancla de la base para la resolucion VIVA por timbre (resolveVoiceIdentity). */
const ancla = (name: string, vector: number[], verified = true) => ({ name, vector, verified });

describe('el hablante primario de la sesion conserva su nombre', () => {
    beforeEach(() => resetVoiceDirectory());

    it('SIN ancla, la MISMA voz conserva su «Hablante N» estable (el primario no la bautiza)', () => {
        // MANDATO 2026-10-18: la primera voz recibe etiqueta ANONIMA. Si la primera voz
        // es la TV (medido en la sesion del dueno), el nombre del onboarding no se le
        // estampa. En la regla viva el primario ni siquiera es una entrada: la fuente no
        // lo conoce (guard estructural).
        const r1 = decidirTurno(vozA, [], 'Hablante 1');
        expect(r1).toMatchObject({ continuidad: false, hablante: 'Hablante 1' });
        const plantillaA = [{ vozId: r1.vozId, vector: vozA, etiqueta: r1.hablante }];
        const r2 = decidirTurno(vozA, plantillaA, 'Hablante 2');
        const r3 = decidirTurno(vozA, plantillaA, 'Hablante 3');
        // Misma voz: continuidad con su plantilla, que devuelve SU etiqueta.
        expect(r2.continuidad, 'la MISMA voz no abre etiqueta nueva').toBe(true);
        expect(r3.continuidad).toBe(true);
        expect(r2.hablante, 'la continuidad devuelve la etiqueta de su plantilla').toBe('Hablante 1');
        expect([r1.hablante, r2.hablante, r3.hablante].every((h) => h !== 'Luis')).toBe(true);
        const regla = readFileSync(join(process.cwd(), 'src', 'voice', 'conversation', 'identidad.ts'), 'utf8');
        expect(regla.includes('sessionPrimary'), 'la regla del modulo no conoce el primario (no puede bautizar)').toBe(false);
    });

    it('con un ancla REGISTRADA preexistente, la MISMA voz mantiene el nombre', () => {
        // El ancla entra por su DATO ("soy Luis" / registro), no la crea el primer turno.
        // La resolucion VIVA por timbre (resolveVoiceIdentity) casa la voz contra el
        // ancla de la base y afirma el nombre en CADA turno. (`model: ''` a proposito:
        // en pruebas el modelo de embeddings no participa y el default lo excluiria.)
        const r1 = resolveVoiceIdentity(vozA, { model: '', candidates: [ancla('Luis', vozA)] });
        const r2 = resolveVoiceIdentity(vozA, { model: '', candidates: [ancla('Luis', vozA)] });
        expect(r1?.name).toBe('Luis');
        expect(r2?.name).toBe('Luis');
    });

    it('CONTROL: una voz DISTINTA no hereda el nombre', () => {
        expect(resolveVoiceIdentity(vozA, { model: '', candidates: [ancla('Luis', vozA)] })?.name).toBe('Luis');
        // La otra voz no casa el ancla de Luis; recibe su propia etiqueta anonima.
        const otra = resolveVoiceIdentity(vozB, { model: '', candidates: [ancla('Luis', vozA)] });
        expect(otra?.name).not.toBe('Luis');
    });

    it('GUARD: el hook enruta la presentacion por voz al dueno unico del registro', () => {
        expect(hookRoutesPresentedToOwner(hookSource())).toBe(true);
    });

    it('GUARD: el primario de una presentacion lo fija el DUENO del registro (fuente presented)', () => {
        expect(ownerSetsPresentedPrimary(ownerSource())).toBe(true);
    });

    it('GUARD: no queda ningun escritor DIRECTO del ref en src (dueno unico)', () => {
        // La ruta del commit viejo se retiro con la tuberia
        // el 2026-10-25; el hook es el unico consumidor que podria escribir el ref.
        expect(directSessionPrimaryWrites(hookSource())).toBe(0);
    });
});

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('identidad de hablante - el detector no es decorativo', () => {
    it('marca el hook que enruta la presentacion y no el que la ignora', () => {
        expect(hookRoutesPresentedToOwner("registerSpeakerIdentity({ name: introducedName, clusters })")).toBe(true)
        expect(hookRoutesPresentedToOwner("setSessionPrimarySpeaker(sessionPrimarySpeakerRef, introducedName, 'presented')")).toBe(false)
        expect(hookRoutesPresentedToOwner('const x = introducedName')).toBe(false)
        expect(directSessionPrimaryWrites('sessionPrimarySpeakerRef.current = name')).toBe(1)
        expect(directSessionPrimaryWrites('setSessionPrimarySpeaker(ref, name)')).toBe(0)
    })

    it('marca al dueno que fija el primario y no al que lo deja a medias', () => {
        const dueno = "const primarySet = setSessionPrimarySpeaker(refs?.sessionPrimarySpeakerRef, clean, source)"
        expect(ownerSetsPresentedPrimary(dueno + " // source = 'presented'")).toBe(true)
        expect(ownerSetsPresentedPrimary("const primarySet = setSessionPrimarySpeaker(ref, clean, source)")).toBe(false)
        expect(ownerSetsPresentedPrimary("setSessionPrimarySpeaker(refs?.sessionPrimarySpeakerRef, clean, 'resolved')")).toBe(false)
    })
})

describe('precedencia del primario de sesion - decide el dueno unico', () => {
    const nuevoRef = () => ({ current: '' });

    it('presented MANDA: el participante no lo pisa', () => {
        const ref = nuevoRef();
        expect(setSessionPrimarySpeaker(ref, 'Luis', 'presented')).toBe(true);
        expect(setSessionPrimarySpeaker(ref, 'Juan', 'participant')).toBe(false);
        expect(ref.current).toBe('Luis');
    });

    it('participant siembra y presented lo puede corregir', () => {
        const ref = nuevoRef();
        expect(setSessionPrimarySpeaker(ref, 'Juan', 'participant')).toBe(true);
        expect(setSessionPrimarySpeaker(ref, 'Luis', 'presented')).toBe(true);
        expect(ref.current).toBe('Luis');
    });

    it('resolved solo RELLENA si esta vacio', () => {
        const ref = nuevoRef();
        expect(setSessionPrimarySpeaker(ref, 'Luis', 'resolved')).toBe(true);
        expect(setSessionPrimarySpeaker(ref, 'Juan', 'resolved')).toBe(false);
        expect(ref.current).toBe('Luis');
    });

    it('no acepta etiquetas automaticas ni vacio', () => {
        const ref = nuevoRef();
        expect(setSessionPrimarySpeaker(ref, 'Hablante 1', 'presented')).toBe(false);
        expect(setSessionPrimarySpeaker(ref, '', 'participant')).toBe(false);
        expect(ref.current).toBe('');
    });

    it('clear limpia el ref y su rango (sesion nueva vuelve a sembrar)', () => {
        const ref = nuevoRef();
        setSessionPrimarySpeaker(ref, 'Luis', 'presented');
        clearSessionPrimarySpeaker(ref);
        expect(ref.current).toBe('');
        expect(setSessionPrimarySpeaker(ref, 'Juan', 'participant')).toBe(true);
    });
});

// ============================================================
// MARCA VERIFICADA del cluster del nombre ("soy X") — d4c1c8f3
// ------------------------------------------------------------
// Medido en la sesion 2026-10-20: el cluster de sesion que nacia de "soy Luis" NO
// llevaba `anchorVerified`, asi que los turnos siguientes de ESA MISMA voz se
// comparaban con el piso registrado general (0.76); la banda real del dueno contra su
// ancla (0.629-0.714) no lo alcanzaba y volvia a "Hablante 1". La afirmacion del
// titular con su medida fresca ES la verificacion del ancla: habilita el piso
// verificado (0.62). Un cluster con firma AJENA (la mujer pegada a "Luis") no se marca.
// ============================================================
describe('"soy X" marca VERIFICADO solo el cluster de SU voz', () => {
    const cos = (a: number[], b: number[]) => {
        let d = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i += 1) {
            d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
        }
        return d / Math.sqrt(na * nb);
    };
    // vozC: mezcla controlada de la voz del titular con una ajena, a coseno ~0.72 de
    // la suya (dentro de la banda medida 0.629-0.714 del dueno; por debajo del piso
    // registrado 0.76 y por encima del verificado 0.62).
    const vozC = (() => {
        let k = 0;
        for (let t = 0.01; t < 20; t += 0.005) {
            const s = cos(vozA, vozA.map((x, i) => x + t * vozB[i]));
            if (s > 0.68 && s < 0.72) { k = t; break; }
        }
        const c = vozA.map((x, i) => x + k * vozB[i]);
        const n = Math.sqrt(c.reduce((acc, x) => acc + x * x, 0));
        return c.map((x) => x / n);
    })();

    it('el cluster del nombre queda ancla VERIFICADA y el piso 0.62 afirma al titular', () => {
        expect(cos(vozA, vozC)).toBeGreaterThan(0.62);
        expect(cos(vozA, vozC)).toBeLessThan(0.76);

        const clusters: { label?: string; signature?: number[]; anchorVerified?: boolean }[] = [
            { label: 'Hablante 1', signature: vozA },
        ];
        let salida: typeof clusters = clusters;
        const r = registerSpeakerIdentity({
            name: 'Luis',
            clusters,
            signatureVector: vozA,
            refs: {
                setClusters: (c: unknown[]) => { salida = c as typeof clusters; },
                sessionPrimarySpeakerRef: { current: '' },
            },
        });
        expect(r.registered).toBe(true);
        const luis = salida.find((c) => c.label === 'Luis');
        expect(luis?.anchorVerified).toBe(true);
        // El titular en su banda real afirma el nombre (antes 0.76 lo excluia): la
        // resolucion VIVA por timbre usa el piso del ancla VERIFICADA (0.62).
        expect(
            resolveVoiceIdentity(vozC, { model: '', candidates: [ancla('Luis', vozA)] })?.name,
        ).toBe('Luis');
    });

    it('FALSIFICACION: el MISMO ancla SIN la marca no afirma al titular (piso 0.76)', () => {
        expect(
            resolveVoiceIdentity(vozC, { model: '', candidates: [ancla('Luis', vozA, false)] })?.name,
            'sin marca verificada el piso registrado excluye la banda 0.62-0.76',
        ).not.toBe('Luis');
    });

    it('un cluster del nombre con firma AJENA no se marca (la mujer no verifica "Luis")', () => {
        const clusters: { label?: string; signature?: number[]; anchorVerified?: boolean }[] = [
            { label: 'Luis', signature: vozB },
        ];
        let salida: typeof clusters = clusters;
        registerSpeakerIdentity({
            name: 'Luis',
            clusters,
            signatureVector: vozA,
            refs: {
                setClusters: (c: unknown[]) => { salida = c as typeof clusters; },
                sessionPrimarySpeakerRef: { current: '' },
            },
        });
        expect(salida.find((c) => c.label === 'Luis')?.anchorVerified).not.toBe(true);
    });

    it('GUARD de fuente: UNA sola escritura de la marca, gateada por la medida', () => {
        const src = ownerSource();
        expect((src.match(/anchorVerified\s*=\s*true/g) || []).length).toBe(1);
        expect(/compareCosineSignatures\(measured,\s*marcado\.signature\)/.test(src)).toBe(true);
    });

    it('GUARD de fuente (2A): la firma del turno pasivo se calcula SOLO sobre el tramo con voz', () => {
        const src = hookSource();
        // El recorte es del dueno unico (`selectVoicedWindow`) y va ANTES de la firma:
        // la ventana completa con audio ajeno envenenaba el ancla de "soy X" (d4c1c8f3).
        expect(/selectVoicedWindow\(audioSnapshot,\s*\{\s*sampleRate\s*\}\)/.test(src)).toBe(true);
        expect(src.indexOf('selectVoicedWindow(audioSnapshot')).toBeLessThan(
            src.indexOf('computeTurnSignature(ventanaVoz'),
        );
    });
});

// AUDITORIA 2026-10-22: borrar un participante no olvidaba su nombre en el DIRECTORIO de
// sesion, asi que el nombre reaparecia al resolver por voz. El dueno del nombre expone ahora
// `forgetVoiceName`.
describe('directorio de sesion: olvidar un nombre (borrado de participante)', () => {
  it('tras olvidarlo, la voz ya no resuelve el nombre', () => {
    registerVoiceName('speaker_2', 'Luis', { vector: [1, 0, 0, 0] })
    expect(resolveVoiceName('speaker_2')).toBe('Luis')
    const olvidadas = forgetVoiceName('Luis')
    expect(olvidadas).toBeGreaterThan(0)
    expect(resolveVoiceName('speaker_2'), 'el nombre olvidado no vuelve').toBe('')
  })

  it('olvidar un nombre que no existe no toca el directorio', () => {
    registerVoiceName('speaker_3', 'Ana', { vector: [0, 1, 0, 0] })
    expect(forgetVoiceName('Nadie')).toBe(0)
    expect(resolveVoiceName('speaker_3')).toBe('Ana')
  })
})

// AUDITORIA 2026-10-22: `resolveSpeakerNameFromUtterance` devolvia '' en las DOS ramas, asi
// que `requireWakeWordForSpeakerName: false` no tenia ningun efecto.
describe('politica de nombres: la config MANDA', () => {
  it('con wake obligatoria, un nombre sin wake NO se resuelve', () => {
    const r = resolveSpeakerNameFromUtterance('soy luis', { roomCfg: { requireWakeWordForSpeakerName: true } as never })
    expect(r).toBe('')
  })

  it('con wake NO obligatoria, el mismo nombre SI se resuelve', () => {
    const r = resolveSpeakerNameFromUtterance('soy luis', { roomCfg: { requireWakeWordForSpeakerName: false } as never })
    expect(r).toBe('Luis')
  })
})
