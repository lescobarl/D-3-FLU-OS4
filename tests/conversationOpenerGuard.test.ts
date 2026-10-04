/**
 * conversationOpenerGuard - el historial que va al modelo NO puede EMPEZAR por
 * turnos de FLU.
 *
 * DEFECTO MEDIDO (2026-10-03, bug del dueno): despues del onboarding el historial
 * que la app envia empieza por las dos lineas de FLU ("¿Como te llamas?" y
 * "¡Listo, luis! Ya estas configurado. Hablame cuando quieras."), y la primera
 * pregunta real ("Platicame de las preparatorias publicas") recibia un SALUDO o
 * el RETRATO DEL PERFIL en vez de la respuesta.
 *
 * Reproducido contra el proxy vivo con el cuerpo REAL capturado (sonda
 * FLU_CONTRACT_TRACE=1) y medido por variantes:
 *   - historial del onboarding + (role/theme/startupPrompt/personality reales)
 *     -> gemini-2.5-flash-lite contesta "Soy FLU, tu asistente administrativo...";
 *   - el MISMO cuerpo con el prefijo quitado -> responde a la pregunta;
 *   - el mismo cuerpo con un historial que empieza por un turno de usuario ->
 *     responde a la pregunta;
 *   - sin startupPrompt el sintoma es el saludo generico ("Soy FLU, tu asistente
 *     de voz... ¿En que puedo ayudarte hoy?"), que es el mismo fallo que reporto
 *     el dueno con "Platicame de los aviones" (P8.27/P8.28).
 *
 * REGLA: una conversacion empieza cuando habla el usuario. Los turnos de FLU
 * anteriores al primer turno de usuario son PRESENTACION de la app, no hilo.
 *
 * Nace ROJO: hoy la asamblea mete ese prefijo tal cual.
 */
import { describe, expect, it } from 'vitest';
import { buildConversationMessages } from '../src/voice/lib/gemini';

/** Entrada minima del historial tal como la manda el motor de voz. */
function entrada(role: string, text: string) {
    return { role, speaker: role === 'user' ? 'Hablante 1' : 'FLU', text, phase: 'SESION_ACTIVA', source: 'log' };
}

/** El onboarding real: FLU pregunta el nombre y confirma. */
const ONBOARDING = [
    entrada('assistant', '¿Cómo te llamas?'),
    entrada('assistant', '¡Listo, luis! Ya estás configurado. Háblame cuando quieras.'),
];

/** Turno de un usuario (lo que la app manda como pregunta actual). */
function turno(transcript: string, history: unknown[]) {
    // `gemini.js` no declara tipos: su firma resuelve `history` a `never[]`, asi que
    // el objeto se pasa tal cual (mismo patron que validateIntegralCtx.test.ts).
    return buildConversationMessages({
        transcript,
        intent: { comando: null, destino: null, parametros: {} },
        speaker: 'Hablante 1',
        theme: 'sesion general',
        role: 'Asistente del Maestro',
        phase: 'SESION_ACTIVA',
        language: 'es',
        history,
    } as any);
}

/**
 * Marca vigilada: la conversacion que va al modelo ABRE con el usuario.
 * @param roles Papel de cada mensaje, en orden.
 */
export function abreLaConversacion(roles: string[]): boolean {
    return roles.length > 0 && roles[0] === 'user';
}

describe('conversationOpenerGuard - la conversacion empieza cuando habla el usuario', () => {
    it('PRUEBA DE DETECTOR: el detector marca el arranque por FLU y no marca el arranque por el usuario', () => {
        expect(abreLaConversacion(['assistant', 'assistant', 'user'])).toBe(false);
        expect(abreLaConversacion(['user', 'assistant', 'user'])).toBe(true);
        expect(abreLaConversacion([])).toBe(false);
    });

    it('el historial del onboarding NO encabeza los mensajes que recibe el modelo', () => {
        const msgs = turno('Platícame de las preparatorias públicas', ONBOARDING);
        const roles = msgs.map((m) => m.role);
        expect(
            abreLaConversacion(roles),
            `la conversacion que va al modelo abre por FLU (roles=${roles.join(',')}): eso es lo que le hace presentarse en vez de responder`,
        ).toBe(true);
        expect(msgs).toHaveLength(1);
        expect(String(msgs[0].content)).toContain('Platícame de las preparatorias públicas');
    });

    it('ANTI-VACUIDAD: una conversacion real (que abre por el usuario) se conserva entera', () => {
        const real = [
            entrada('user', '¿Y tú cómo te llamas?'),
            entrada('assistant', 'Soy FLU, tu asistente administrativo.'),
        ];
        const msgs = turno('Platícame de las preparatorias públicas', real);
        expect(msgs).toHaveLength(3);
        expect(msgs[0].role).toBe('user');
        expect(msgs[1].role).toBe('assistant');
        expect(String(msgs[0].content)).toContain('¿Y tú cómo te llamas?');
        expect(String(msgs[1].content)).toContain('Soy FLU');
    });

    it('un historial mixto conserva DESDE el primer turno de usuario (no borra el hilo)', () => {
        const mixto = [
            entrada('assistant', '¡Listo, luis! Ya estás configurado.'),
            entrada('user', 'Hola'),
            entrada('assistant', 'Hola, luis.'),
        ];
        const msgs = turno('Platícame de las preparatorias públicas', mixto);
        expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    });
});
