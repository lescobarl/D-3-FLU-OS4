// ============================================================
// configCommands — Resolvedor determinista de comandos de configuración por voz
//   - resolveConfigCommandFromText  (verbo + sustantivo del catálogo + valor)
//   - normalizeConfiguracion        (sanitiza el `configuracion` del modelo)
//   - matchers (season / mode / language / provider / emotion / boolean / number)
// Objetivo: validar el fix de rebranding de primavera (aunque el modelo solo
// verbalice, el contrato `configuracion` se deriva del texto transcrito y fluye
// por la ÚNICA ruta existente: contract.configuracion → App.tsx applyConfigAction).
// Sin parches ni rutas dobles: cada expectativa refleja el comportamiento REAL
// del módulo + VOICE_CONFIG_CATALOG + PALETTES (data-driven).
// ============================================================
import { describe, test, expect } from 'vitest';
import {
    normalizeForMatch,
    hasToken,
    matchSeason,
    matchMode,
    matchLanguage,
    matchProvider,
    matchEmotion,
    resolveBooleanValue,
    resolveNumberValue,
    resolveDateValue,
    resolveConfigCommandFromText,
    normalizeConfiguracion,
} from '../src/voice/lib/configCommands';
import { VOICE_CONFIG_CATALOG } from '../src/core/config/voiceConfigCatalog';

// Clave real aún sin implementar, derivada del catálogo (data-driven, sin hardcode):
// si algún día el catálogo implementa todo, este vector se omite (no hay qué rechazar).
const unsupportedEntry = VOICE_CONFIG_CATALOG.find((e) => e.handler === 'unsupported');

const SPRING = { accion: 'set_branding', componente: 'branding', clave: 'activeSeason', valor: 'primavera' };

describe('configCommands — rebranding primavera (bug determinista)', () => {
    test.each([
        'cambia la temporada a primavera',
        'pon el tema de primavera',
        'activa la temporada de primavera',
        'change the season to spring',
        'set the theme to spring',
    ])('%s → set_branding activeSeason=primavera', (phrase) => {
        expect(resolveConfigCommandFromText(phrase)).toEqual(SPRING);
    });

    test('insensible a acentos: otoño → otono', () => {
        expect(resolveConfigCommandFromText('pon el tema de otoño')).toEqual({
            accion: 'set_branding',
            componente: 'branding',
            clave: 'activeSeason',
            valor: 'otono',
        });
    });

    test('insensible a acentos: día de muertos → muertos', () => {
        expect(resolveConfigCommandFromText('pon el tema de día de muertos')).toEqual({
            accion: 'set_branding',
            componente: 'branding',
            clave: 'activeSeason',
            valor: 'muertos',
        });
    });
});

describe('configCommands — sin afectación (guardia triple: no dispara en conversación casual)', () => {
    test.each([
        'quita ese frasco de la mesa', // verbo de directiva pero sin sustantivo de configuración
        'cuéntame un chiste', // sin verbo de directiva
        '¿tienes un modo nocturno?', // pregunta casual, no directiva
        'cambia el canal a deportes', // sustantivo "canal" no existe en el catálogo
        'cambia la velocidad de voz', // verbo + sustantivo pero sin valor numérico resoluble
    ])('%s → null', (phrase) => {
        expect(resolveConfigCommandFromText(phrase)).toBeNull();
    });
});

describe('configCommands — otros tipos de configuración', () => {
    test('cambia el modo a manual → set_branding mode=manual', () => {
        expect(resolveConfigCommandFromText('cambia el modo a manual')).toEqual({
            accion: 'set_branding',
            componente: 'branding',
            clave: 'mode',
            valor: 'manual',
        });
    });

    test('pon el idioma en inglés → set_config language=en', () => {
        expect(resolveConfigCommandFromText('pon el idioma en inglés')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'language',
            valor: 'en',
        });
    });

    test('cambia el proveedor de ia a gemini → set_config aiProvider=gemini', () => {
        expect(resolveConfigCommandFromText('cambia el proveedor de ia a gemini')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'aiProvider',
            valor: 'gemini',
        });
    });

    test('oculta la gorra → set_config capVisible=false', () => {
        expect(resolveConfigCommandFromText('oculta la gorra')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'capVisible',
            valor: 'false',
        });
    });

    test('muestra la gorra → set_config capVisible=true', () => {
        expect(resolveConfigCommandFromText('muestra la gorra')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'capVisible',
            valor: 'true',
        });
    });

    test('sube la velocidad de voz a 1.5 → set_config voiceSpeed=1.5', () => {
        expect(resolveConfigCommandFromText('sube la velocidad de voz a 1.5')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'voiceSpeed',
            valor: '1.5',
        });
    });

    test('restablece los colores del avatar → set_config resetAvatarColors=reset', () => {
        expect(resolveConfigCommandFromText('restablece los colores del avatar')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'resetAvatarColors',
            valor: 'reset',
        });
    });
});

describe('configCommands — tipos text/list/color/voice (completados)', () => {
    test('pon mi rol de sesión a profesor → set_config sessionRole=profesor', () => {
        expect(resolveConfigCommandFromText('pon mi rol de sesión a profesor')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'sessionRole',
            valor: 'profesor',
        });
    });

    test('cambia mis instrucciones personalizadas a sé amable → customInstructions=amable', () => {
        expect(resolveConfigCommandFromText('cambia mis instrucciones personalizadas a sé amable')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'customInstructions',
            valor: 'amable',
        });
    });

    test('agrega el rasgo cómico → traits=cómico (subvalor add)', () => {
        expect(resolveConfigCommandFromText('agrega el rasgo cómico')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'traits',
            valor: 'cómico',
            subvalor: 'add',
        });
    });

    test('quita el rasgo curioso → traits=curioso (subvalor remove)', () => {
        expect(resolveConfigCommandFromText('quita el rasgo curioso')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'traits',
            valor: 'curioso',
            subvalor: 'remove',
        });
    });

    test('pon el color del pantalón rojo → pantsColor=#FF0000', () => {
        expect(resolveConfigCommandFromText('pon el color del pantalón rojo')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'pantsColor',
            valor: '#FF0000',
        });
    });

    test('pon el color del avatar verde → avatarColor=Bunny_body:#00FF00', () => {
        expect(resolveConfigCommandFromText('pon el color del avatar verde')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'avatarColor',
            valor: 'Bunny_body:#00FF00',
        });
    });

    test('pon el color del cuerpo azul → bodyColor=#0000FF', () => {
        expect(resolveConfigCommandFromText('pon el color del cuerpo azul')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'bodyColor',
            valor: '#0000FF',
        });
    });

    test('pon la voz a esperanza → voice=esperanza', () => {
        expect(resolveConfigCommandFromText('pon la voz a esperanza')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'voice',
            valor: 'esperanza',
        });
    });
});

describe('configCommands — wakeWords / debugLogs / clearCache (completados)', () => {
    test('agrega la palabra de activación hola flu → wakeWords=hola flu (add)', () => {
        expect(resolveConfigCommandFromText('agrega la palabra de activación hola flu')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'wakeWords',
            valor: 'hola flu',
            subvalor: 'add',
        });
    });

    test('quita la palabra de activación hey flu → wakeWords=hey flu (remove)', () => {
        expect(resolveConfigCommandFromText('quita la palabra de activación hey flu')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'wakeWords',
            valor: 'hey flu',
            subvalor: 'remove',
        });
    });

    test('activa los logs de depuración → debugLogs=true', () => {
        expect(resolveConfigCommandFromText('activa los logs de depuración')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'debugLogs',
            valor: 'true',
        });
    });

    test('desactiva los logs de depuración → debugLogs=false', () => {
        expect(resolveConfigCommandFromText('desactiva los logs de depuración')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'debugLogs',
            valor: 'false',
        });
    });

    test('limpia la caché → clearCache=reset', () => {
        expect(resolveConfigCommandFromText('limpia la caché')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'clearCache',
            valor: 'reset',
        });
    });
});

describe('configCommands — cumpleaños (resolución determinista de fecha)', () => {
    test('cambia mi fecha de cumpleaños al 14 de febrero → birthday=2000-02-14', () => {
        expect(resolveConfigCommandFromText('cambia mi fecha de cumpleaños al 14 de febrero')).toEqual({
            accion: 'set_branding',
            componente: 'branding',
            clave: 'birthday',
            valor: '2000-02-14',
        });
    });

    test('establece mi cumpleaños el 25 de diciembre → birthday=2000-12-25', () => {
        expect(resolveConfigCommandFromText('establece mi cumpleaños el 25 de diciembre')).toEqual({
            accion: 'set_branding',
            componente: 'branding',
            clave: 'birthday',
            valor: '2000-12-25',
        });
    });

    test('día en palabra: catorce de febrero → 2000-02-14', () => {
        expect(resolveConfigCommandFromText('cambia mi cumpleaños al catorce de febrero')).toEqual({
            accion: 'set_branding',
            componente: 'branding',
            clave: 'birthday',
            valor: '2000-02-14',
        });
    });

    test('fecha ISO con año real: 1995-03-10', () => {
        expect(resolveConfigCommandFromText('cambia mi cumpleaños a 1995-03-10')).toEqual({
            accion: 'set_branding',
            componente: 'branding',
            clave: 'birthday',
            valor: '1995-03-10',
        });
    });

    test('resolveDateValue directo: 29 de febrero (año 2000 bisiesto) → 2000-02-29', () => {
        expect(resolveDateValue('29 de febrero')).toBe('2000-02-29');
    });
});

describe('configCommands — branding de cumpleaños por voz (fix determinista)', () => {
    // Regresión del incidente real: "pon el branding de cumpleaños" no aplicaba.
    // Causa raíz: el sustantivo 'cumpleanos' (birthday, 9 caracteres) ganaba por
    // longitud a 'branding' (activeSeason, 8) y enrutaba el comando a birthday
    // (fecha sin resolvedor textual) → no-op → el branding dependía 100 % de la
    // respuesta emocional de Gemini. Ahora gana el sustantivo que aparece PRIMERO
    // en la frase (posición), así que 'branding' prevalece y el Camino A aplica
    // set_branding de forma determinista.
    const CUMPLEANOS_BRANDING = {
        accion: 'set_branding',
        componente: 'branding',
        clave: 'activeSeason',
        valor: 'cumpleanos',
    };

    test.each([
        'pon el branding de cumpleaños', // frase exacta del incidente (captura limpia)
        'pon el branding de cumpleanos', // variante sin acento (transcripción ASR)
        'pon el tema de cumpleaños', // mismo branding por el sustantivo "tema"
        'pon el tema de cumpleanos',
        'okay flu pon el branding de cumpleaños', // captura con wake word (la que despacha)
        'club pon el branding de cumpleaños', // prefijo de ruido ASR ("Club")
    ])('%s → set_branding activeSeason=cumpleanos', (phrase) => {
        expect(resolveConfigCommandFromText(phrase)).toEqual(CUMPLEANOS_BRANDING);
    });

    test('activa la temporada de cumpleaños → set_branding activeSeason=cumpleanos', () => {
        // Antes era no-op: el sustantivo 'cumpleanos' robaba el comando a 'temporada'.
        // Con la regla de posición, 'temporada' (primero en la frase) gana y aplica.
        expect(resolveConfigCommandFromText('activa la temporada de cumpleaños')).toEqual(
            CUMPLEANOS_BRANDING,
        );
    });

    test('la fecha de cumpleaños sigue resolviéndose (sin regresión de birthday)', () => {
        expect(resolveConfigCommandFromText('cambia mi fecha de cumpleaños al 14 de febrero')).toEqual({
            accion: 'set_branding',
            componente: 'branding',
            clave: 'birthday',
            valor: '2000-02-14',
        });
    });
});

describe('configCommands — festividad personalizada (add/remove)', () => {
    test('agrega festividad con fecha → subvalor add + valor "nombre|MM-DD|paleta"', () => {
        expect(resolveConfigCommandFromText('agrega la festividad del día de la madre el 10 de mayo')).toEqual({
            accion: 'set_branding',
            componente: 'branding',
            clave: 'customEvent',
            valor: 'dia de la madre|05-10|madres',
            subvalor: 'add',
        });
    });

    test('crea evento personalizado con nombre explícito → conserva nombre y fecha', () => {
        // Nota: "septiembre" es alias de la temporada patrio en buildSeasonAliases,
        // así que la paleta resuelve a "patrio" (comportamiento determinista real).
        expect(resolveConfigCommandFromText('crea un evento personalizado llamado aniversario de boda el 3 de septiembre')).toEqual({
            accion: 'set_branding',
            componente: 'branding',
            clave: 'customEvent',
            valor: 'aniversario de boda|09-03|patrio',
            subvalor: 'add',
        });
    });

    test('quita festividad por nombre → subvalor remove + valor con fecha vacía', () => {
        expect(resolveConfigCommandFromText('quita la festividad de navidad')).toEqual({
            accion: 'set_branding',
            componente: 'branding',
            clave: 'customEvent',
            valor: 'navidad||navidad',
            subvalor: 'remove',
        });
    });

    test('agrega festividad sin fecha → null (no resoluble)', () => {
        expect(resolveConfigCommandFromText('agrega la festividad de navidad')).toBeNull();
    });
});

describe('normalizeConfiguracion — sanitiza el contrato emitido por el modelo', () => {
    test('objeto válido con valor numérico → string', () => {
        expect(normalizeConfiguracion({ accion: 'set_config', clave: 'voiceSpeed', valor: 1.5 })).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'voiceSpeed',
            valor: '1.5',
        });
    });

    test('JSON string válido', () => {
        expect(normalizeConfiguracion('{"accion":"set_config","clave":"language","valor":"en"}')).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'language',
            valor: 'en',
        });
    });

    test('valor booleano → string', () => {
        expect(normalizeConfiguracion({ accion: 'set_config', clave: 'capVisible', valor: false })).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'capVisible',
            valor: 'false',
        });
    });

    test('traits con subvalor → contrato con subvalor', () => {
        expect(
            normalizeConfiguracion({ accion: 'set_config', clave: 'traits', valor: 'creativo', subvalor: 'adicionar' }),
        ).toEqual({
            accion: 'set_config',
            componente: 'config',
            clave: 'traits',
            valor: 'creativo',
            subvalor: 'adicionar',
        });
    });

    test.each([
        ['accion inválida', { accion: 'navegar', clave: 'language', valor: 'en' }],
        ['clave faltante', { accion: 'set_config', valor: 'en' }],
        ['valor faltante', { accion: 'set_config', clave: 'language' }],
        ['traits sin subvalor (requiereSubvalor)', { accion: 'set_config', clave: 'traits', valor: 'creativo' }],
        ['null', null],
        ['undefined', undefined],
        ['JSON string no parseable', 'no soy json'],
    ])('%s → null', (_name, raw) => {
        expect(normalizeConfiguracion(raw)).toBeNull();
    });

    if (unsupportedEntry) {
        // Data-driven: la clave NO soportada real del catálogo (sin hardcode).
        // Si algún día el catálogo implementa todo, este test se omite.
        test(`handler unsupported (${unsupportedEntry.clave}) → null`, () => {
            expect(
                normalizeConfiguracion({ accion: 'set_config', clave: unsupportedEntry.clave, valor: 'x' }),
            ).toBeNull();
        });
    }
});

describe('configCommands — matchers', () => {
    test('normalizeForMatch: minúsculas, sin acentos, espacios colapsados', () => {
        expect(normalizeForMatch('  Pon el   Tema de Otoño ')).toBe('pon el tema de otono');
    });

    test('hasToken respeta límites de palabra (sin falsos positivos)', () => {
        expect(hasToken('activa la temporada', 'activa')).toBe(true);
        expect(hasToken('desactiva la temporada', 'activa')).toBe(false);
        expect(hasToken('cambia settings', 'set')).toBe(false);
        expect(hasToken('pon set', 'set')).toBe(true);
    });

    test('matchSeason resuelve temporadas data-driven (PALETTES)', () => {
        expect(matchSeason('primavera')).toBe('primavera');
        expect(matchSeason('verano')).toBe('verano');
        expect(matchSeason('otoño')).toBe('otono');
        expect(matchSeason('día de muertos')).toBe('muertos');
        expect(matchSeason('no hay temporada')).toBeNull();
    });

    test('matchMode / matchLanguage / matchProvider / matchEmotion', () => {
        expect(matchMode('manual')).toBe('manual');
        expect(matchMode('automático')).toBe('auto');
        expect(matchLanguage('inglés')).toBe('en');
        expect(matchLanguage('español')).toBe('es');
        expect(matchProvider('gemini')).toBe('gemini');
        expect(matchProvider('openrouter')).toBe('openrouter');
        expect(matchEmotion('feliz')).toBe('happy');
    });

    test('resolveBooleanValue: los negativos dominan', () => {
        expect(resolveBooleanValue('no muestres la gorra')).toBe('false');
        expect(resolveBooleanValue('muestra la gorra')).toBe('true');
    });

    test('resolveNumberValue respeta min/max', () => {
        expect(resolveNumberValue('ponla a 3.5', { min: 0.1, max: 10 })).toBe('3.5');
        expect(resolveNumberValue('ponla a 50', { min: 0.1, max: 10 })).toBeNull();
    });
});
