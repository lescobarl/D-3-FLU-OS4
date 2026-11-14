// @vitest-environment node
// BARRERA: turno-ia
/**
 * LA PETICIÓN A LA IA SALE DEL TURNO COMMITEADO — ni antes ni con otro texto.
 *
 * DEFECTO MEDIDO EN VIVO (2026-11-12): la petición a la IA se armaba con la
 * captura cruda del ASR MIENTRAS la locución seguía abierta, y la respuesta
 * aparecía asociada a otra frase (a veces ANTES que la fila del usuario en la
 * bitácora). Además, el turno vigente viajaba también dentro del historial: el
 * modelo veía la misma pregunta dos veces y podía responder a una versión vieja.
 *
 * DÓNDE VIVE LA BARRERA. El turno lo acuña el MÓDULO (`locucionAbierta.turnId`);
 * el hook ESPERA su fila (`esperarFilaDelTurno` → `turnRowWait.ts`, liberada
 * por `row.committed`) y usa SU texto como frase canónica y SU turnId como
 * identidad de la petición. `sinTurnoDelHistorial` (`conversationDialogue.js`)
 * recorta ESE turno del historial (la petición vigente viaja solo como último
 * mensaje), y `buildConversationMessages` mueve los turnos de usuario que
 * quedaron SIN respuesta a un bloque de contexto declarado, nunca al canal de
 * instrucciones. La ruta `commitOnly` (pedir sin fila) se retiró.
 *
 * FALSIFICACIÓN: sin el recorte, la fila del turno vigente aparece dos veces
 * (historial + petición final); sin el bloque declarado, los turnos sin
 * respuesta entran como mensajes de usuario y el modelo puede ejecutar una
 * petición vieja como si fuera la actual.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildConversationMessages } from '../src/voice/lib/gemini'
import { deriveDialogueHistory } from '../src/voice/lib/conversationDialogue'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig'

const fuente = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

const hook = (): string => fuente('src/voice/hooks/useFluVoiceAssistant.js')

/** Archivos de código fuente bajo src/ (la barrera vale en TODO el árbol). */
function fuentesDeSrc(dir = join(process.cwd(), 'src')): string[] {
    const out: string[] = []
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const ruta = join(dir, entrada.name)
        if (entrada.isDirectory()) out.push(...fuentesDeSrc(ruta))
        else if (/\.(?:ts|tsx|js|jsx)$/.test(entrada.name)) out.push(ruta)
    }
    return out
}

describe('la petición a la IA espera la FILA del turno (dueño: el módulo)', () => {
    it('la frase canónica y el turnId salen de la fila commiteada, no de la captura del ASR', () => {
        const src = hook()
        const espera = src.indexOf('const filaDelTurno = await esperarFilaDelTurno(turnoEnVuelo)')
        // La llamada QUE CONSUME LA FILA (hay otro `commitTurnPhrase` legítimo
        // en el pasivo): su argumento es la fila del turno.
        const frase = src.indexOf('filaDelTurno?.texto,')
        expect(espera).toBeGreaterThanOrEqual(0)
        expect(frase).toBeGreaterThan(espera)
        expect(src).toContain('const turnIdDelTurno = String(filaDelTurno?.turnId ?? turnoEnVuelo).trim()')
        expect(src).toContain('turnId: turnIdDelTurno,')
    })

    it('CONTRATO ASR LOCAL: el texto del respaldo por tramo NO se convierte en petición', () => {
        // §8 de docs/CONTRATO-ASR-LOCAL.md: una fila `origen: 'local'` no es
        // accionable — su texto no puede ser la frase canónica del turno ni
        // llegar al árbitro/IA. El turno degrada a lo que Chrome solo habría
        // producido (su captura o nada). Falsificación: sin la condición, el
        // texto del respaldo entra como petición del usuario.
        // El vocabulario tiene UN dueño (`esOrigenLocal` en bridge.ts): la
        // guarda exige el predicado, no la comparación contra la cadena.
        expect(hook()).toContain("esOrigenLocal(filaDelTurno?.origen) ? '' : filaDelTurno?.texto,")
    })

    it('la espera es por turnId y tiene techo de tiempo (sin fila responde el ASR)', () => {
        const src = hook()
        // El registro de esperas vive en su módulo; el hook solo delega.
        const espera = fuente('src/voice/conversation/turnRowWait.ts')
        const config = FLU_CONFIG as { timing?: { turnCommitWaitMs?: number } }
        expect(Number(config.timing?.turnCommitWaitMs)).toBeGreaterThan(0)
        expect(espera).toContain('esperas.get(clave)')
        expect(espera).toContain('if (!clave) return Promise.resolve(null)')
        expect(src).toContain('esperaDeFilaRef.current.publicar(fila)')
        expect(src).toContain('esperaDeFilaRef.current.esperar(turnId)')
        expect(src).toContain('resolverFilaDelTurno(fila)')
    })

    it('el turno vigente se recorta del historial de la petición', () => {
        const src = hook()
        // El recorte es la regla del diálogo; el hook le entrega el contexto.
        const dialogo = fuente('src/voice/lib/conversationDialogue.js')
        expect(src).toContain('history: getHistoryForTurn(turnId),')
        expect(dialogo).toContain("String(entry?.turnId ?? '').trim() !== clave")
        // La ruta que pedía SIN fila se retiró: no queda una segunda forma de pedir.
        expect(
            fuentesDeSrc().filter((ruta) => /commitOnly/.test(readFileSync(ruta, 'utf8'))),
        ).toEqual([])
    })

    it('las filas del store llevan su turnId al diálogo de la IA', () => {
        const dialogo = deriveDialogueHistory([
            { role: 'user', text: 'hola', turnId: 9 },
            { role: 'flu', text: 'buenas', turnId: 9 },
        ])
        expect(dialogo.map((entrada) => entrada.turnId)).toEqual([9, 9])
    })
})

describe('buildConversationMessages — sin-respuesta viaja como CONTEXTO, no como instrucción', () => {
    const entrada = (role: string, text: string, turnId: number) => ({
        role,
        speaker: role === 'user' ? 'Hablante 1' : 'FLU',
        text,
        phase: 'SESION_ACTIVA',
        source: 'log',
        turnId,
    })

    const mensajes = (language: string) =>
        buildConversationMessages({
            transcript: '¿Qué hora es?',
            intent: { comando: null, destino: null, parametros: {} },
            speaker: 'Hablante 1',
            theme: 'sesion general',
            role: 'Asistente del Maestro',
            phase: 'SESION_ACTIVA',
            language,
            history: [
                entrada('user', 'Pon música', 1),
                entrada('assistant', 'Listo, reproduciendo.', 1),
                entrada('user', 'Sube el volumen', 2),
                entrada('user', 'Y apaga la luz del pasillo', 3),
            ],
        } as any)

    it('la petición VIGENTE es el último mensaje del usuario', () => {
        const msgs = mensajes('es')
        const ultimo = msgs[msgs.length - 1]
        expect(ultimo.role).toBe('user')
        expect(String(ultimo.content)).toContain('¿Qué hora es?')
    })

    it('los turnos sin respuesta NO entran por el canal del usuario', () => {
        const msgs = mensajes('es')
        const comoUsuario = msgs.filter((m) => m.role === 'user').map((m) => String(m.content))
        expect(comoUsuario.some((texto) => texto.includes('Sube el volumen'))).toBe(false)
        expect(comoUsuario.some((texto) => texto.includes('apaga la luz'))).toBe(false)
    })

    it('viajan en UN bloque system etiquetado como contexto, antes de la petición', () => {
        const msgs = mensajes('es')
        const sistemas = msgs.filter((m) => m.role === 'system')
        expect(sistemas).toHaveLength(1)
        const bloque = String(sistemas[0].content)
        expect(bloque).toContain('Contexto — dicho por el usuario, sin respuesta')
        expect(bloque).toContain('Sube el volumen')
        expect(bloque).toContain('apaga la luz del pasillo')
        expect(msgs.indexOf(sistemas[0])).toBeLessThan(msgs.length - 1)
    })

    it('en inglés la etiqueta también lo declara contexto', () => {
        const bloque = String(mensajes('en').find((m) => m.role === 'system')?.content ?? '')
        expect(bloque).toContain('Context only')
    })
})
