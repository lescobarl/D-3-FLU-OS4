// @vitest-environment node
// BARRERA: flu-escritor
/**
 * LA FILA DE FLU TIENE UN ÚNICO DUEÑO — hablar y registrar van juntos.
 *
 * DEFECTO MEDIDO EN VIVO (2026-11-12): la respuesta de FLU aparecía ANTES de la
 * petición del usuario en la bitácora y podía duplicarse. Había dos escritores
 * del mismo hecho: App escribía `setLastResponse` + `logFluReply` al resolver el
 * contrato, y la fila también podía nacer de la ruta que habla. Con dos puertas,
 * el orden dependía de qué ruta corriera primero.
 *
 * DÓNDE VIVE LA BARRERA. `speakFlu` (el ÚNICO camino para que FLU hable) escribe
 * la fila por `logFluReply` ANTES de `speakResponse`, con el `turnId` de la
 * resolución: la fila existe cuando el TTS empieza y la ventana de eco del
 * turno la cubre completa. `logFluReply` es idempotente por turno (la identidad
 * de la fila es el turnId, nunca el texto) y `addFluEntry` sigue siendo el dueño
 * de `lastResponse`; App no escribe nada.
 *
 * FALSIFICACIÓN: dos rutas del MISMO turno que llamen `logFluReply` producen UNA
 * fila (idempotencia por turnId); si la identidad fuera el texto, un turno con
 * texto repetido legítimo se perdería (D11).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import { logFluReply } from '../src/voice/lib/fluConversationLog'

const fuente = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

const fluRows = () =>
    useIntegrationStore.getState().conversationHistory.filter((row) => row.role === 'flu')

describe('respuesta de FLU: un solo dueño, y escribe ANTES de hablar', () => {
    it('App no escribe la fila ni invoca al escritor (el escritor que se retiró no vuelve)', () => {
        const app = fuente('src/App.tsx')
        expect(app).not.toMatch(/addFluMessage\(/)
        expect(app).not.toMatch(/logFluReply\(/)
        expect(app).not.toMatch(/setLastResponse\(/)
    })

    it('el único invocador de logFluReply es speakFlu, y registra antes de speakResponse', () => {
        const nav = fuente('src/hooks/useNavigationCommands.ts')
        expect(nav.match(/logFluReply\(/g) ?? []).toHaveLength(1)
        const registro = nav.indexOf('logFluReply(')
        const habla = nav.indexOf('await speakResponse(')
        expect(registro).toBeGreaterThanOrEqual(0)
        expect(habla).toBeGreaterThan(registro)
        // El turnId es identidad de la fila, NO opción de voz: se separa antes
        // de hablar para que nunca llegue al sintetizador.
        expect(nav).toContain('const { turnId, ...speechOptions } = opts ?? {};')
        expect(nav).toContain('logFluReply(text, { turnId });')
        expect(nav).toContain('await speakResponse(text, lang, speechOptions);')
    })

    it('App entrega a speakFlu el turnId de la resolución del contrato', () => {
        expect(fuente('src/App.tsx')).toContain('{ turnId: resolved?.turnId }')
    })
})

describe('logFluReply — identidad de fila por turno, nunca por texto', () => {
    beforeEach(() => {
        useIntegrationStore.getState().resetConversationHistory()
    })

    it('dos rutas del MISMO turno escriben UNA sola fila', () => {
        logFluReply('Son las nueve y media.', { turnId: 42 })
        logFluReply('Son las nueve y media.', { turnId: 42 })
        expect(fluRows()).toHaveLength(1)
    })

    it('el mismo texto en turnos distintos SÍ se registra (D11: no hay dedupe por texto)', () => {
        logFluReply('Listo.', { turnId: 7 })
        logFluReply('Listo.', { turnId: 8 })
        expect(fluRows()).toHaveLength(2)
    })

    it('la fila de FLU actualiza lastResponse sin un segundo escritor', () => {
        logFluReply('Son las diez.', { turnId: 5 })
        expect(useIntegrationStore.getState().lastResponse).toBe('Son las diez.')
    })
})
